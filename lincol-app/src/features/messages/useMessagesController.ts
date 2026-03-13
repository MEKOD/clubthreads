import {
    useCallback,
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/axios';
import type { DirectConversationSummary, DirectFriend, DirectMessage } from '../../lib/social';
import { useAuthStore } from '../../store/authStore';
import { useDmCryptoStore } from '../../store/dmCryptoStore';
import { useDmStore, type DirectMessageRealtimeEvent } from '../../store/dmStore';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import type { ComposerAttachment, LocalDirectMessage, SearchUser } from './types';
import { decryptDirectMessageContent, encryptDirectMessageContent } from './crypto';
import {
    buildConversationStatePatch,
    buildOptimisticMessage,
    createClientId,
    getHighestSequence,
    getLowestSequence,
    isNearBottom,
    mergeConversationSummary,
    mergeMessages,
    patchConversation,
    patchFriendConversation,
    patchFriendUnread,
    patchMessageStatus,
    readApiError,
    readVideoDuration,
    upsertConversation,
} from './utils';

const MESSAGE_PAGE_LIMIT = 50;
const READ_FLUSH_MS = 160;
const TYPING_IDLE_MS = 1200;
const REMOTE_TYPING_TTL_MS = 3200;
const ACTIVE_THREAD_SYNC_MS = 7000;
const MAX_DM_IMAGE_SIZE_BYTES = 12 * 1024 * 1024;
const MAX_DM_VIDEO_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_DM_VIDEO_DURATION_SECONDS = 30;

export function useMessagesController() {
    const navigate = useNavigate();
    const { username: routeUsername } = useParams<{ username?: string }>();
    const currentUser = useAuthStore((state) => state.user);
    const dmCryptoOwnerUserId = useDmCryptoStore((state) => state.ownerUserId);
    const dmPublicKey = useDmCryptoStore((state) => state.publicKey);
    const dmPrivateKey = useDmCryptoStore((state) => state.privateKey);
    const hasActiveThread = Boolean(routeUsername);
    const unreadCount = useDmStore((state) => state.unreadCount);
    const setUnreadCount = useDmStore((state) => state.setUnreadCount);
    const [friends, setFriends] = useState<DirectFriend[]>([]);
    const [loadingFriends, setLoadingFriends] = useState(true);
    const [conversations, setConversations] = useState<DirectConversationSummary[]>([]);
    const [loadingConversations, setLoadingConversations] = useState(true);
    const [activeConversation, setActiveConversation] = useState<DirectConversationSummary | null>(null);
    const [messages, setMessages] = useState<LocalDirectMessage[]>([]);
    const [loadingThread, setLoadingThread] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [syncingLatest, setSyncingLatest] = useState(false);
    const [hasMoreOlder, setHasMoreOlder] = useState(false);
    const [threadError, setThreadError] = useState<string | null>(null);
    const [composerError, setComposerError] = useState<string | null>(null);
    const [composerText, setComposerText] = useState('');
    const [composerAttachment, setComposerAttachment] = useState<ComposerAttachment | null>(null);
    const [isGifPickerOpen, setIsGifPickerOpen] = useState(false);
    const [validatingAttachment, setValidatingAttachment] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
    const [searching, setSearching] = useState(false);
    const [counterpartyTyping, setCounterpartyTyping] = useState(false);
    const threadScrollRef = useRef<HTMLDivElement | null>(null);
    const composerRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const composerDockRef = useRef<HTMLFormElement | null>(null);
    const threadRequestSeqRef = useRef(0);
    const originSessionIdRef = useRef(createClientId());
    const objectUrlsRef = useRef<string[]>([]);
    const activeConversationRef = useRef<DirectConversationSummary | null>(null);
    const messagesRef = useRef<LocalDirectMessage[]>([]);
    const hasMoreOlderRef = useRef(false);
    const loadingOlderRef = useRef(false);
    const syncingLatestRef = useRef(false);
    const typingStateRef = useRef<{ conversationId: string | null; isTyping: boolean }>({ conversationId: null, isTyping: false });
    const typingStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const remoteTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const readQueueRef = useRef<Record<string, number>>({});
    const readFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingBottomScrollRef = useRef<ScrollBehavior | null>(null);
    const [mobileComposerLift, setMobileComposerLift] = useState(0);
    const [mobileComposerHeight, setMobileComposerHeight] = useState(76);
    const [scrollRequestToken, setScrollRequestToken] = useState(0);

    useEffect(() => {
        activeConversationRef.current = activeConversation;
    }, [activeConversation]);

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        hasMoreOlderRef.current = hasMoreOlder;
    }, [hasMoreOlder]);

    useEffect(() => {
        loadingOlderRef.current = loadingOlder;
    }, [loadingOlder]);

    useEffect(() => {
        syncingLatestRef.current = syncingLatest;
    }, [syncingLatest]);

    const activePrivateKey = dmCryptoOwnerUserId === currentUser?.id ? dmPrivateKey : null;

    const hydrateMessage = useCallback(async (message: DirectMessage | LocalDirectMessage): Promise<LocalDirectMessage> => {
        if (!message.encryptedPayload) {
            return {
                ...message,
                isEncrypted: Boolean(message.isEncrypted),
            };
        }

        try {
            const decryptedContent = await decryptDirectMessageContent({
                encryptedPayload: message.encryptedPayload,
                senderId: message.senderId,
                currentUserId: currentUser?.id,
                privateKey: activePrivateKey,
            });

            return {
                ...message,
                content: decryptedContent,
                isEncrypted: true,
            };
        } catch (error) {
            console.error('DM decrypt failed', error);
            return {
                ...message,
                content: null,
                isEncrypted: true,
            };
        }
    }, [activePrivateKey, currentUser?.id]);

    const hydrateConversation = useCallback(async (
        conversation: DirectConversationSummary | null | undefined
    ): Promise<DirectConversationSummary | null> => {
        if (!conversation?.lastMessage?.encryptedPayload) {
            return conversation ?? null;
        }

        try {
            const decryptedContent = await decryptDirectMessageContent({
                encryptedPayload: conversation.lastMessage.encryptedPayload,
                senderId: conversation.lastMessage.senderId ?? conversation.otherUserId,
                currentUserId: currentUser?.id,
                privateKey: activePrivateKey,
            });

            return {
                ...conversation,
                lastMessage: {
                    ...conversation.lastMessage,
                    content: decryptedContent,
                    isEncrypted: true,
                },
            };
        } catch (error) {
            console.error('DM conversation preview decrypt failed', error);
            return {
                ...conversation,
                lastMessage: {
                    ...conversation.lastMessage,
                    content: null,
                    isEncrypted: true,
                },
            };
        }
    }, [activePrivateKey, currentUser?.id]);

    const hydrateMessages = useCallback(async (items: DirectMessage[]) => {
        return Promise.all(items.map((item) => hydrateMessage(item)));
    }, [hydrateMessage]);

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        const viewport = threadScrollRef.current;
        if (!viewport) {
            return;
        }

        viewport.scrollTo({
            top: viewport.scrollHeight,
            behavior,
        });
    }, []);

    const queueScrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        pendingBottomScrollRef.current = behavior;
        setScrollRequestToken((current) => current + 1);
    }, []);

    useLayoutEffect(() => {
        const behavior = pendingBottomScrollRef.current;
        if (!behavior) {
            return;
        }

        pendingBottomScrollRef.current = null;
        scrollToBottom(behavior);
    }, [counterpartyTyping, messages, mobileComposerHeight, mobileComposerLift, scrollRequestToken, scrollToBottom]);

    const applyConversationEverywhere = useCallback((conversation: DirectConversationSummary) => {
        setConversations((current) => upsertConversation(current, conversation));
        setActiveConversation((current) => (
            current?.id === conversation.id ? mergeConversationSummary(current, conversation) : current
        ));
        setFriends((current) => patchFriendConversation(current, conversation));
    }, []);

    const patchConversationEverywhere = useCallback((conversationId: string, patch: Partial<DirectConversationSummary>) => {
        setConversations((current) => patchConversation(current, conversationId, patch));
        setActiveConversation((current) => (
            current?.id === conversationId ? mergeConversationSummary(current, patch) : current
        ));

        if (typeof patch.unreadCount === 'number') {
            setFriends((current) => patchFriendUnread(current, conversationId, patch.unreadCount ?? 0));
        }
    }, []);

    const clearRemoteTypingIndicator = useCallback(() => {
        if (remoteTypingTimeoutRef.current) {
            window.clearTimeout(remoteTypingTimeoutRef.current);
            remoteTypingTimeoutRef.current = null;
        }

        setCounterpartyTyping(false);
    }, []);

    const clearComposerAttachment = useCallback(() => {
        setComposerAttachment(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    const applySelectedFile = useCallback(async (file: File | null) => {
        if (!file) {
            clearComposerAttachment();
            return;
        }

        if (file.type === 'image/gif') {
            setComposerError('GIF icin GIF seciciyi kullan.');
            clearComposerAttachment();
            return;
        }

        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
            setComposerError('Sadece foto veya video gonderebilirsin.');
            clearComposerAttachment();
            return;
        }

        if (file.type.startsWith('image/') && file.size > MAX_DM_IMAGE_SIZE_BYTES) {
            setComposerError('Foto boyutu en fazla 12 MB olabilir.');
            clearComposerAttachment();
            return;
        }

        if (file.type.startsWith('video/') && file.size > MAX_DM_VIDEO_SIZE_BYTES) {
            setComposerError('DM icin video boyutu en fazla 8 MB olabilir.');
            clearComposerAttachment();
            return;
        }

        setValidatingAttachment(true);
        setComposerError(null);

        try {
            if (file.type.startsWith('video/')) {
                const duration = await readVideoDuration(file);
                if (duration > MAX_DM_VIDEO_DURATION_SECONDS) {
                    setComposerError('DM videosu en fazla 30 saniye olabilir.');
                    clearComposerAttachment();
                    return;
                }
            }

            const objectUrl = URL.createObjectURL(file);
            objectUrlsRef.current.push(objectUrl);

            setComposerAttachment({
                kind: 'file',
                file,
                previewUrl: objectUrl,
                mediaMimeType: file.type.startsWith('video/') ? 'video/mp4' : 'image/webp',
            });
        } catch (error) {
            console.error('Attachment validation failed', error);
            setComposerError('Secilen medya okunamadi.');
            clearComposerAttachment();
        } finally {
            setValidatingAttachment(false);
        }
    }, [clearComposerAttachment]);

    const loadFriends = useCallback(async (withSpinner = false) => {
        if (withSpinner) {
            setLoadingFriends(true);
        }

        try {
            const response = await api.get('/dm/friends?limit=14');
            setFriends((response.data.friends ?? []) as DirectFriend[]);
        } catch (error) {
            console.error('Friend list failed', error);
        } finally {
            if (withSpinner) {
                setLoadingFriends(false);
            }
        }
    }, []);

    const loadConversations = useCallback(async (withSpinner = false) => {
        if (withSpinner) {
            setLoadingConversations(true);
        }

        try {
            const response = await api.get('/dm/conversations?limit=40');
            const hydratedConversations = await Promise.all(
                ((response.data.conversations ?? []) as DirectConversationSummary[]).map((item) => hydrateConversation(item))
            );
            setConversations(hydratedConversations.filter((item): item is DirectConversationSummary => Boolean(item)));
            setUnreadCount(response.data.unreadCount ?? 0);
        } catch (error) {
            console.error('Conversation list failed', error);
        } finally {
            if (withSpinner) {
                setLoadingConversations(false);
            }
        }
    }, [hydrateConversation, setUnreadCount]);

    const markConversationRead = useCallback(async (conversationId: string, readThroughSequence: number) => {
        if (!readThroughSequence) return;

        try {
            const response = await api.patch(`/dm/conversations/${conversationId}/read`, { readThroughSequence });
            if (typeof response.data.unreadCount === 'number') {
                setUnreadCount(response.data.unreadCount);
            }
            patchConversationEverywhere(conversationId, {
                unreadCount: response.data.conversationUnreadCount ?? 0,
                ...buildConversationStatePatch(response.data as Record<string, unknown>),
            });
        } catch (error) {
            console.error('Conversation read state failed', error);
        }
    }, [patchConversationEverywhere, setUnreadCount]);

    const flushQueuedReads = useCallback(() => {
        const queuedReads = readQueueRef.current;
        readQueueRef.current = {};
        readFlushTimeoutRef.current = null;

        for (const [conversationId, sequence] of Object.entries(queuedReads)) {
            if (!sequence) {
                continue;
            }

            void markConversationRead(conversationId, sequence);
        }
    }, [markConversationRead]);

    const stopTyping = useCallback(async (conversationId?: string | null) => {
        const nextConversationId = conversationId ?? activeConversationRef.current?.id ?? null;

        if (typingStopTimeoutRef.current) {
            window.clearTimeout(typingStopTimeoutRef.current);
            typingStopTimeoutRef.current = null;
        }

        if (!nextConversationId) {
            typingStateRef.current = { conversationId: null, isTyping: false };
            return;
        }

        if (!typingStateRef.current.isTyping || typingStateRef.current.conversationId !== nextConversationId) {
            typingStateRef.current = { conversationId: nextConversationId, isTyping: false };
            return;
        }

        typingStateRef.current = { conversationId: nextConversationId, isTyping: false };

        try {
            await api.post(`/dm/conversations/${nextConversationId}/typing`, { isTyping: false });
        } catch (error) {
            console.error('Typing stop failed', error);
        }
    }, []);

    const sendTypingStart = useCallback(async (conversationId: string) => {
        if (typingStateRef.current.isTyping && typingStateRef.current.conversationId === conversationId) {
            return;
        }

        typingStateRef.current = { conversationId, isTyping: true };

        try {
            await api.post(`/dm/conversations/${conversationId}/typing`, { isTyping: true });
        } catch (error) {
            console.error('Typing start failed', error);
        }
    }, []);

    const queueConversationRead = useCallback((conversationId: string, sequence: number) => {
        if (!sequence) return;

        readQueueRef.current[conversationId] = Math.max(readQueueRef.current[conversationId] ?? 0, sequence);

        if (readFlushTimeoutRef.current) {
            return;
        }

        readFlushTimeoutRef.current = window.setTimeout(() => {
            flushQueuedReads();
        }, READ_FLUSH_MS);
    }, [flushQueuedReads]);

    const loadThread = useCallback(async (username: string) => {
        const requestId = ++threadRequestSeqRef.current;
        clearRemoteTypingIndicator();
        setLoadingThread(true);
        setThreadError(null);
        setComposerError(null);
        setHasMoreOlder(false);

        try {
            const ensureResponse = await api.post('/dm/conversations', {
                username,
                includeMessages: true,
                messageLimit: MESSAGE_PAGE_LIMIT,
            });
            const ensuredConversation = ensureResponse.data.conversation as DirectConversationSummary;

            if (requestId !== threadRequestSeqRef.current) {
                return;
            }

            const rawConversation = ensureResponse.data.conversation
                ? mergeConversationSummary(ensuredConversation, ensureResponse.data.conversation as DirectConversationSummary)
                : ensuredConversation;
            const [nextConversation, hydratedMessages] = await Promise.all([
                hydrateConversation(rawConversation),
                hydrateMessages((ensureResponse.data.messages ?? []) as DirectMessage[]),
            ]);
            const nextMessages = mergeMessages([], hydratedMessages);

            setActiveConversation(nextConversation);
            setMessages(nextMessages);
            setHasMoreOlder(Boolean(ensureResponse.data.hasMoreOlder ?? ensureResponse.data.hasMore));
            if (nextConversation) {
                applyConversationEverywhere(nextConversation);
            }

            if (
                nextConversation
                && 
                document.visibilityState === 'visible'
                && (nextConversation.lastMessageSequence ?? 0) > (nextConversation.viewerLastSeenSequence ?? 0)
            ) {
                queueConversationRead(nextConversation.id, nextConversation.lastMessageSequence ?? 0);
            }

            queueScrollToBottom(nextMessages.length > 8 ? 'auto' : 'smooth');
        } catch (error) {
            console.error('Conversation thread failed', error);
            if (requestId !== threadRequestSeqRef.current) {
                return;
            }
            setActiveConversation(null);
            setMessages([]);
            setThreadError(readApiError(error, 'Sohbet yuklenemedi.'));
        } finally {
            if (requestId === threadRequestSeqRef.current) {
                setLoadingThread(false);
            }
        }
    }, [applyConversationEverywhere, clearRemoteTypingIndicator, hydrateConversation, hydrateMessages, queueConversationRead, queueScrollToBottom]);

    const refreshConversationEncryptionState = useCallback(async (conversation: DirectConversationSummary) => {
        const response = await api.post('/dm/conversations', {
            username: conversation.otherUsername,
            includeMessages: false,
        });
        const nextConversation = await hydrateConversation(response.data.conversation as DirectConversationSummary | undefined);
        if (nextConversation) {
            applyConversationEverywhere(nextConversation);
        }
        return nextConversation;
    }, [applyConversationEverywhere, hydrateConversation]);

    const resolveRecipientPublicKey = useCallback(async (conversation: DirectConversationSummary) => {
        if (conversation.otherDmPublicKey) {
            return conversation.otherDmPublicKey;
        }

        const refreshedConversation = await refreshConversationEncryptionState(conversation);
        return refreshedConversation?.otherDmPublicKey ?? null;
    }, [refreshConversationEncryptionState]);

    const loadOlderMessages = useCallback(async () => {
        const conversation = activeConversationRef.current;
        const firstSequence = getLowestSequence(messagesRef.current);

        if (!conversation || !hasMoreOlderRef.current || loadingOlderRef.current || !firstSequence) {
            return;
        }

        setLoadingOlder(true);
        const viewport = threadScrollRef.current;
        const previousScrollHeight = viewport?.scrollHeight ?? 0;
        const previousScrollTop = viewport?.scrollTop ?? 0;

        try {
            const response = await api.get(
                `/dm/conversations/${conversation.id}/messages?beforeSequence=${firstSequence}&limit=${MESSAGE_PAGE_LIMIT}`
            );

            if (activeConversationRef.current?.id !== conversation.id) {
                return;
            }

            const olderMessages = await hydrateMessages((response.data.messages ?? []) as DirectMessage[]);
            setMessages((current) => mergeMessages(current, olderMessages));
            setHasMoreOlder(Boolean(response.data.hasMoreOlder ?? response.data.hasMore));

            if (response.data.conversation) {
                const nextConversation = await hydrateConversation(
                    mergeConversationSummary(conversation, response.data.conversation as DirectConversationSummary)
                );
                if (nextConversation) {
                    applyConversationEverywhere(nextConversation);
                }
            }

            requestAnimationFrame(() => {
                if (!viewport) return;
                const nextScrollHeight = viewport.scrollHeight;
                viewport.scrollTop = previousScrollTop + (nextScrollHeight - previousScrollHeight);
            });
        } catch (error) {
            console.error('Older messages failed', error);
        } finally {
            setLoadingOlder(false);
        }
    }, [applyConversationEverywhere, hydrateConversation, hydrateMessages]);

    const syncLatestMessages = useCallback(async (preferScroll = false) => {
        const conversation = activeConversationRef.current;

        if (!conversation || syncingLatestRef.current) {
            return;
        }

        const afterSequence = Math.max(conversation.lastMessageSequence ?? 0, getHighestSequence(messagesRef.current));
        if (!afterSequence) {
            return;
        }

        setSyncingLatest(true);
        const shouldStickToBottom = isNearBottom(threadScrollRef.current);

        try {
            const response = await api.get(
                `/dm/conversations/${conversation.id}/messages?afterSequence=${afterSequence}&limit=${MESSAGE_PAGE_LIMIT}`
            );

            if (activeConversationRef.current?.id !== conversation.id) {
                return;
            }

            const nextMessages = await hydrateMessages((response.data.messages ?? []) as DirectMessage[]);

            if (nextMessages.length > 0) {
                setMessages((current) => mergeMessages(current, nextMessages));
            }

            if (response.data.conversation) {
                const nextConversation = await hydrateConversation(mergeConversationSummary(
                    conversation,
                    response.data.conversation as DirectConversationSummary
                ));
                if (nextConversation) {
                    applyConversationEverywhere(nextConversation);

                    if (
                        document.visibilityState === 'visible'
                        && (nextConversation.lastMessageSequence ?? 0) > (nextConversation.viewerLastSeenSequence ?? 0)
                    ) {
                        queueConversationRead(nextConversation.id, nextConversation.lastMessageSequence ?? 0);
                    }
                }
            }

            if (nextMessages.length > 0 && (preferScroll || shouldStickToBottom)) {
                queueScrollToBottom(nextMessages.some((item) => item.senderId !== currentUser?.id) ? 'auto' : 'smooth');
            }
        } catch (error) {
            console.error('Latest messages sync failed', error);
        } finally {
            setSyncingLatest(false);
        }
    }, [applyConversationEverywhere, currentUser?.id, hydrateConversation, hydrateMessages, queueConversationRead, queueScrollToBottom]);

    useEffect(() => {
        void Promise.all([
            loadFriends(true),
            loadConversations(true),
        ]);
    }, [loadConversations, loadFriends]);

    useEffect(() => {
        if (!routeUsername) {
            threadRequestSeqRef.current += 1;
            clearRemoteTypingIndicator();
            setActiveConversation(null);
            setMessages([]);
            setHasMoreOlder(false);
            setThreadError(null);
            setComposerError(null);
            setLoadingThread(false);
            clearComposerAttachment();
            void stopTyping(activeConversationRef.current?.id);
            return;
        }

        void loadThread(routeUsername);
    }, [clearComposerAttachment, clearRemoteTypingIndicator, loadThread, routeUsername, stopTyping]);

    useEffect(() => {
        if (searchQuery.trim().length < 1) {
            setSearchResults([]);
            setSearching(false);
            return;
        }

        const timeoutId = window.setTimeout(async () => {
            setSearching(true);
            try {
                const response = await api.get(`/search/users?q=${encodeURIComponent(searchQuery)}&mutualOnly=true`);
                const items = (response.data.users ?? []) as SearchUser[];
                setSearchResults(items.filter((item) => item.username !== currentUser?.username));
            } catch (error) {
                console.error('User search failed', error);
                setSearchResults([]);
            } finally {
                setSearching(false);
            }
        }, 220);

        return () => window.clearTimeout(timeoutId);
    }, [currentUser?.username, searchQuery]);

    const refreshMessagesView = useCallback(() => {
        if (routeUsername) {
            if (activeConversationRef.current?.id) {
                void syncLatestMessages();
            } else {
                void loadThread(routeUsername);
            }
            return;
        }

        void loadFriends();
        void loadConversations();
    }, [loadConversations, loadFriends, loadThread, routeUsername, syncLatestMessages]);

    useEffect(() => {
        if (!hasActiveThread) {
            return;
        }

        const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void syncLatestMessages();
            }
        }, ACTIVE_THREAD_SYNC_MS);

        return () => window.clearInterval(intervalId);
    }, [hasActiveThread, syncLatestMessages]);

    useEffect(() => {
        if (hasActiveThread) {
            return;
        }

        const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                refreshMessagesView();
            }
        }, 20_000);

        return () => window.clearInterval(intervalId);
    }, [hasActiveThread, refreshMessagesView]);

    useVisibilityRefresh(refreshMessagesView, { minHiddenMs: 12000 });

    useEffect(() => {
        const handleStreamOpen = () => {
            if (document.visibilityState !== 'visible') {
                return;
            }

            refreshMessagesView();
        };

        window.addEventListener('dm-stream-open', handleStreamOpen);
        return () => window.removeEventListener('dm-stream-open', handleStreamOpen);
    }, [refreshMessagesView]);

    useEffect(() => {
        const viewport = threadScrollRef.current;
        if (!viewport || !hasActiveThread) {
            return;
        }

        const handleScroll = () => {
            if (viewport.scrollTop < 120) {
                void loadOlderMessages();
            }
        };

        viewport.addEventListener('scroll', handleScroll);
        return () => viewport.removeEventListener('scroll', handleScroll);
    }, [hasActiveThread, loadOlderMessages]);

    const handleRealtimeEvent = useEffectEvent((payload: DirectMessageRealtimeEvent) => {
        const currentUserId = currentUser?.id;
        const activeThread = activeConversationRef.current;
        const isActiveRealtimeThread = activeThread?.id === payload.conversationId;

        if (payload.event === 'dm:typing') {
            if (!isActiveRealtimeThread || payload.senderId === currentUserId) {
                return;
            }

            if (payload.typing) {
                setCounterpartyTyping(true);
                if (remoteTypingTimeoutRef.current) {
                    window.clearTimeout(remoteTypingTimeoutRef.current);
                }
                remoteTypingTimeoutRef.current = window.setTimeout(() => {
                    setCounterpartyTyping(false);
                    remoteTypingTimeoutRef.current = null;
                }, REMOTE_TYPING_TTL_MS);
            } else {
                clearRemoteTypingIndicator();
            }

            return;
        }

        if (payload.event === 'dm:delivered') {
            patchConversationEverywhere(payload.conversationId, {
                otherLastDeliveredSequence: payload.deliveredThroughSequence,
            });
            return;
        }

        if (payload.event === 'dm:seen') {
            patchConversationEverywhere(payload.conversationId, {
                otherLastDeliveredSequence: payload.deliveredThroughSequence ?? payload.seenThroughSequence,
                otherLastSeenSequence: payload.seenThroughSequence ?? payload.readThroughSequence,
            });
            return;
        }

        if (payload.event === 'dm:read') {
            if (typeof payload.totalUnreadCount === 'number') {
                setUnreadCount(payload.totalUnreadCount);
            }

            patchConversationEverywhere(payload.conversationId, {
                unreadCount: payload.conversationUnreadCount ?? 0,
                viewerLastDeliveredSequence: payload.deliveredThroughSequence ?? payload.seenThroughSequence,
                viewerLastSeenSequence: payload.seenThroughSequence ?? payload.readThroughSequence,
            });
            return;
        }

        if (payload.event !== 'dm:new' || !payload.message || !payload.conversation) {
            return;
        }

        void (async () => {
            const [hydratedMessage, hydratedConversationBase] = await Promise.all([
                hydrateMessage(payload.message as DirectMessage),
                hydrateConversation(payload.conversation as DirectConversationSummary),
            ]);

            if (!hydratedConversationBase) {
                return;
            }

            const isIncoming = payload.senderId !== currentUserId;
            const shouldStickToBottom = isNearBottom(threadScrollRef.current);
            const nextConversation = isIncoming && isActiveRealtimeThread
                ? { ...hydratedConversationBase, unreadCount: 0 }
                : hydratedConversationBase;

            applyConversationEverywhere(nextConversation);

            if (!isActiveRealtimeThread) {
                return;
            }

            if (isIncoming) {
                clearRemoteTypingIndicator();
            }

            setMessages((current) => mergeMessages(current, hydratedMessage));

            if (isIncoming) {
                const readSequence = hydratedMessage.sequence ?? payload.messageSequence ?? nextConversation.lastMessageSequence ?? 0;
                patchConversationEverywhere(payload.conversationId, { unreadCount: 0 });
                queueConversationRead(payload.conversationId, readSequence);
            }

            if (shouldStickToBottom || !isIncoming) {
                queueScrollToBottom(isIncoming ? 'auto' : 'smooth');
            }
        })();
    });

    useEffect(() => {
        const listener = (event: Event) => {
            handleRealtimeEvent((event as CustomEvent<DirectMessageRealtimeEvent>).detail);
        };

        window.addEventListener('dm-event', listener as EventListener);
        return () => window.removeEventListener('dm-event', listener as EventListener);
    }, []);

    useEffect(() => {
        const textarea = composerRef.current;
        if (!textarea) {
            return;
        }

        textarea.style.height = '0px';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }, [composerText, activeConversation?.id]);

    useEffect(() => {
        if (!activeConversation?.canMessage) {
            return;
        }

        if (window.matchMedia('(min-width: 768px)').matches) {
            composerRef.current?.focus();
        }
    }, [activeConversation?.canMessage, activeConversation?.id]);

    useEffect(() => {
        if (!hasActiveThread) {
            setMobileComposerHeight(76);
            return;
        }

        const updateComposerHeight = () => {
            if (window.matchMedia('(min-width: 768px)').matches) {
                setMobileComposerHeight(0);
                return;
            }

            setMobileComposerHeight(composerDockRef.current?.offsetHeight ?? 76);
        };

        updateComposerHeight();

        if (typeof ResizeObserver === 'undefined' || !composerDockRef.current) {
            return;
        }

        const observer = new ResizeObserver(updateComposerHeight);
        observer.observe(composerDockRef.current);
        return () => observer.disconnect();
    }, [activeConversation?.canMessage, composerText, hasActiveThread]);

    useEffect(() => {
        if (!hasActiveThread) {
            setMobileComposerLift(0);
            return;
        }

        const viewport = window.visualViewport;
        if (!viewport) {
            return;
        }

        const updateViewportInset = () => {
            if (window.matchMedia('(min-width: 768px)').matches) {
                setMobileComposerLift(0);
                return;
            }

            const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
            const keyboardHeight = Math.max(0, layoutHeight - viewport.height - viewport.offsetTop);
            setMobileComposerLift(keyboardHeight > 120 ? keyboardHeight : 0);
        };

        updateViewportInset();

        viewport.addEventListener('resize', updateViewportInset);
        viewport.addEventListener('scroll', updateViewportInset);
        window.addEventListener('orientationchange', updateViewportInset);

        return () => {
            viewport.removeEventListener('resize', updateViewportInset);
            viewport.removeEventListener('scroll', updateViewportInset);
            window.removeEventListener('orientationchange', updateViewportInset);
        };
    }, [hasActiveThread]);

    useEffect(() => {
        if (mobileComposerLift > 0) {
            queueScrollToBottom('auto');
        }
    }, [mobileComposerLift, queueScrollToBottom]);

    useEffect(() => {
        const conversation = activeConversation;
        const hasText = composerText.trim().length > 0;

        if (!conversation?.canMessage) {
            void stopTyping(conversation?.id);
            return;
        }

        if (!hasText) {
            void stopTyping(conversation.id);
            return;
        }

        void sendTypingStart(conversation.id);

        if (typingStopTimeoutRef.current) {
            window.clearTimeout(typingStopTimeoutRef.current);
        }

        typingStopTimeoutRef.current = window.setTimeout(() => {
            void stopTyping(conversation.id);
        }, TYPING_IDLE_MS);
    }, [activeConversation, composerText, sendTypingStart, stopTyping]);

    useEffect(() => () => {
        if (readFlushTimeoutRef.current) {
            window.clearTimeout(readFlushTimeoutRef.current);
        }
        flushQueuedReads();
        if (typingStopTimeoutRef.current) {
            window.clearTimeout(typingStopTimeoutRef.current);
        }
        if (remoteTypingTimeoutRef.current) {
            window.clearTimeout(remoteTypingTimeoutRef.current);
        }
        for (const objectUrl of objectUrlsRef.current) {
            URL.revokeObjectURL(objectUrl);
        }
        objectUrlsRef.current = [];
        void stopTyping(activeConversationRef.current?.id);
    }, [flushQueuedReads, stopTyping]);

    const handleOpenConversation = (username: string) => {
        setSearchQuery('');
        setSearchResults([]);
        setComposerError(null);
        setIsGifPickerOpen(false);
        clearComposerAttachment();
        clearRemoteTypingIndicator();
        void stopTyping(activeConversationRef.current?.id);
        navigate(`/messages/${username}`);
    };

    const handleSend = async (event?: FormEvent<HTMLFormElement>) => {
        event?.preventDefault();

        const conversation = activeConversationRef.current;
        const content = composerText.trim();
        const attachment = composerAttachment;

        if (!conversation || (!content && !attachment) || !currentUser || !conversation.canMessage || validatingAttachment) {
            return;
        }

        const clientMessageId = createClientId();
        const optimisticMessage = buildOptimisticMessage({
            conversationId: conversation.id,
            senderId: currentUser.id,
            senderUsername: currentUser.username,
            senderProfilePic: currentUser.profilePic ?? null,
            senderRole: currentUser.role,
            content: content || undefined,
            mediaUrl: attachment?.previewUrl ?? null,
            mediaMimeType: attachment?.mediaMimeType ?? null,
            clientMessageId,
        });

        setComposerError(null);
        setComposerText('');
        clearComposerAttachment();
        setIsGifPickerOpen(false);
        void stopTyping(conversation.id);
        setCounterpartyTyping(false);
        setMessages((current) => mergeMessages(current, optimisticMessage));

        const optimisticConversation = mergeConversationSummary(conversation, {
            lastMessageAt: optimisticMessage.createdAt,
            lastMessage: {
                id: optimisticMessage.id,
                senderId: optimisticMessage.senderId,
                content: optimisticMessage.content,
                mediaUrl: optimisticMessage.mediaUrl ?? null,
                mediaMimeType: optimisticMessage.mediaMimeType ?? null,
                createdAt: optimisticMessage.createdAt,
            },
        });
        applyConversationEverywhere(optimisticConversation);

        queueScrollToBottom();

        try {
            if (!dmPublicKey) {
                throw new Error('DM sifreleme anahtarin hazir degil. Bir kez daha oturumu kapatip ac ve tekrar dene.');
            }

            const recipientPublicKey = await resolveRecipientPublicKey(conversation);
            if (!recipientPublicKey) {
                throw new Error(`@${conversation.otherUsername} henuz guvenli mesajlasma icin bir kez giris yapmamis. Onun da bir kez oturumu kapatip acmasi gerekiyor.`);
            }

            let mediaUrl: string | undefined;
            let mediaMimeType: string | undefined;

            if (attachment?.kind === 'file' && attachment.file) {
                const formData = new FormData();
                formData.append('file', attachment.file);

                const mediaResponse = await api.post('/media/upload', formData, {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                });

                mediaUrl = mediaResponse.data.url ?? mediaResponse.data.mediaUrl ?? undefined;
                mediaMimeType = mediaResponse.data.mimeType ?? mediaResponse.data.mediaMimeType ?? attachment.mediaMimeType;
            } else if (attachment?.kind === 'gif') {
                mediaUrl = attachment.previewUrl;
                mediaMimeType = attachment.mediaMimeType;
            }

            if (attachment && (!mediaUrl || !mediaMimeType)) {
                throw new Error('Medya yukleme responseu gecersiz. DM mesaji olusturulamadi.');
            }

            const encryptedPayload = await encryptDirectMessageContent({
                text: content,
                senderPublicKey: dmPublicKey,
                recipientPublicKey,
            });

            const response = await api.post(`/dm/conversations/${conversation.id}/messages`, {
                encryptedPayload,
                mediaUrl,
                mediaMimeType,
                clientMessageId,
                originSessionId: originSessionIdRef.current,
            });
            const [message, nextConversation] = await Promise.all([
                hydrateMessage(response.data.message as DirectMessage),
                hydrateConversation(response.data.conversation as DirectConversationSummary | undefined),
            ]);

            if (activeConversationRef.current?.id === conversation.id) {
                setMessages((current) => mergeMessages(current, { ...message, status: undefined }));
            }

            if (nextConversation) {
                applyConversationEverywhere(nextConversation);
            }

            if (activeConversationRef.current?.id === conversation.id) {
                queueScrollToBottom('smooth');
            }
        } catch (error) {
            console.error('Send message failed', error);
            if (activeConversationRef.current?.id === conversation.id) {
                setMessages((current) => patchMessageStatus(current, clientMessageId, 'failed'));
                setComposerError(readApiError(error, 'Mesaj gonderilemedi.'));
            }
        }
    };

    const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleSend();
        }
    };

    const handleComposerTextChange = (value: string) => {
        setComposerText(value);
        if (composerError) {
            setComposerError(null);
        }
    };

    const openFilePicker = () => {
        fileInputRef.current?.click();
    };

    const openGifPicker = () => {
        setIsGifPickerOpen(true);
    };

    const closeGifPicker = () => {
        setIsGifPickerOpen(false);
    };

    const handleGifSelect = (url: string) => {
        clearComposerAttachment();
        setComposerError(null);
        setComposerAttachment({
            kind: 'gif',
            previewUrl: url,
            mediaMimeType: 'image/gif',
        });
        setIsGifPickerOpen(false);
    };

    const handleComposerFocus = () => {
        queueScrollToBottom('auto');
    };

    const handleComposerBlur = () => {
        void stopTyping(activeConversation?.id);
    };

    const goToMessagesList = () => {
        navigate('/messages');
    };

    const goToProfile = (username: string) => {
        navigate(`/users/${username}`);
    };

    const showSearchResults = searchQuery.trim().length > 0;
    const activeConversationId = activeConversation?.id;
    const canSubmitMessage = Boolean(
        (composerText.trim() || composerAttachment) && activeConversation?.canMessage && !validatingAttachment
    );

    return {
        routeUsername,
        hasActiveThread,
        currentUser,
        unreadCount,
        friends,
        loadingFriends,
        conversations,
        loadingConversations,
        activeConversation,
        activeConversationId,
        messages,
        loadingThread,
        loadingOlder,
        syncingLatest,
        hasMoreOlder,
        threadError,
        composerError,
        composerText,
        composerAttachment,
        isGifPickerOpen,
        validatingAttachment,
        searchQuery,
        searchResults,
        searching,
        counterpartyTyping,
        threadScrollRef,
        composerRef,
        fileInputRef,
        composerDockRef,
        mobileComposerLift,
        mobileComposerHeight,
        showSearchResults,
        canSubmitMessage,
        setSearchQuery,
        applySelectedFile,
        clearComposerAttachment,
        closeGifPicker,
        goToMessagesList,
        goToProfile,
        handleComposerBlur,
        handleComposerFocus,
        handleComposerKeyDown,
        handleComposerTextChange,
        handleGifSelect,
        handleOpenConversation,
        handleSend,
        loadOlderMessages,
        openFilePicker,
        openGifPicker,
    };
}
