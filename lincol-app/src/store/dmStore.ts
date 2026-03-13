import { create } from 'zustand';
import { api, API_URL } from '../lib/axios';
import { createAuthenticatedEventStream } from '../lib/authenticatedEventStream';
import type { DirectConversationSummary, DirectMessage } from '../lib/social';
import { useAuthStore } from './authStore';

export interface DirectMessageRealtimeEvent {
    event: 'dm:new' | 'dm:read' | 'dm:seen' | 'dm:typing' | 'dm:delivered';
    userId: string;
    conversationId: string;
    messageId?: string;
    messageSequence?: number;
    senderId?: string;
    unreadCount?: number;
    totalUnreadCount?: number;
    totalUnreadDelta?: number;
    conversationUnreadCount?: number;
    senderUsername?: string;
    typing?: boolean;
    counterpartyUsername?: string;
    clientMessageId?: string;
    originSessionId?: string;
    readerUserId?: string;
    readAt?: string;
    readThroughMessageId?: string;
    readThroughSequence?: number;
    deliveredThroughSequence?: number;
    seenThroughSequence?: number;
    message?: DirectMessage;
    conversation?: DirectConversationSummary;
    at: string;
}

interface DmStore {
    unreadCount: number;
    setUnreadCount: (count: number) => void;
    bumpUnreadCount: (delta: number) => void;
    fetchUnreadCount: () => Promise<void>;
}

export const useDmStore = create<DmStore>((set) => ({
    unreadCount: 0,
    setUnreadCount: (count) => set({ unreadCount: count }),
    bumpUnreadCount: (delta) => set((state) => ({ unreadCount: Math.max(0, state.unreadCount + delta) })),
    fetchUnreadCount: async () => {
        try {
            const response = await api.get('/dm/unread-count');
            set({ unreadCount: response.data.unreadCount ?? 0 });
        } catch {
            // silently fail
        }
    },
}));

let started = false;
let source: ReturnType<typeof createAuthenticatedEventStream> | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

function dispatchRealtimeEvent(payload: DirectMessageRealtimeEvent) {
    window.dispatchEvent(new CustomEvent<DirectMessageRealtimeEvent>('dm-event', { detail: payload }));
}

function dispatchStreamOpen() {
    window.dispatchEvent(new Event('dm-stream-open'));
}

export function startDmListener() {
    if (started) return;
    started = true;

    const poll = () => {
        const token = useAuthStore.getState().token;
        if (token) {
            void useDmStore.getState().fetchUnreadCount();
        }
    };

    const ensurePolling = () => {
        if (pollInterval) return;
        pollInterval = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                poll();
            }
        }, 30_000);
    };

    const connectSSE = () => {
        const token = useAuthStore.getState().token;
        if (!token) return;

        let retryDelay = 1000;

        const connect = () => {
            const nextSource = createAuthenticatedEventStream({
                url: `${API_URL}/dm/stream`,
                token,
                onOpen: () => {
                    retryDelay = 1000;
                    poll();
                    dispatchStreamOpen();
                },
                onError: () => {
                    nextSource.close();
                    if (source === nextSource) {
                        source = null;
                    }
                    reconnectTimeout = window.setTimeout(connect, retryDelay);
                    retryDelay = Math.min(retryDelay * 2, 30_000);
                },
            });
            source = nextSource;

            const handleEvent = () => (event: MessageEvent<string>) => {
                try {
                    const payload = JSON.parse(event.data) as DirectMessageRealtimeEvent;
                    const currentUserId = useAuthStore.getState().user?.id;
                    const totalUnreadCount = payload.totalUnreadCount ?? payload.unreadCount;
                    const totalUnreadDelta = payload.totalUnreadDelta;

                    if (payload.event === 'dm:new' && payload.senderId && payload.senderId !== currentUserId) {
                        if (typeof totalUnreadCount === 'number') {
                            useDmStore.getState().setUnreadCount(totalUnreadCount);
                        } else if (typeof totalUnreadDelta === 'number') {
                            useDmStore.getState().bumpUnreadCount(totalUnreadDelta);
                        } else {
                            useDmStore.getState().bumpUnreadCount(1);
                        }
                    }

                    if (payload.event === 'dm:read') {
                        if (typeof totalUnreadCount === 'number') {
                            useDmStore.getState().setUnreadCount(totalUnreadCount);
                        } else if (typeof totalUnreadDelta === 'number') {
                            useDmStore.getState().bumpUnreadCount(totalUnreadDelta);
                        }
                    }

                    dispatchRealtimeEvent(payload);
                } catch {
                    // ignore malformed events
                }
            };

            source.addEventListener('dm:new', handleEvent());
            source.addEventListener('dm:read', handleEvent());
            source.addEventListener('dm:seen', handleEvent());
            source.addEventListener('dm:typing', handleEvent());
            source.addEventListener('dm:delivered', handleEvent());
        };

        connect();
    };

    poll();
    ensurePolling();
    connectSSE();

    window.addEventListener('focus', poll);

    useAuthStore.subscribe((state, prev) => {
        if (state.token !== prev.token) {
            source?.close();
            source = null;
            if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
            if (pollInterval) {
                window.clearInterval(pollInterval);
                pollInterval = null;
            }

            if (state.token) {
                connectSSE();
                ensurePolling();
                poll();
            } else {
                useDmStore.getState().setUnreadCount(0);
            }
        }
    });
}
