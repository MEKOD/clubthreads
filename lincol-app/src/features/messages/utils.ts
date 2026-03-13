import type { DirectConversationSummary, DirectFriend } from '../../lib/social';
import type { LocalDirectMessage } from './types';

export function createClientId() {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatConversationTimestamp(value?: string | null) {
    if (!value) return '';
    const date = new Date(value);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();

    return sameDay
        ? date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function formatBubbleTimestamp(value: string) {
    return new Date(value).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function getMediaLabel(mediaMimeType?: string | null) {
    switch (mediaMimeType) {
        case 'image/gif':
            return 'GIF';
        case 'image/webp':
            return 'Foto';
        case 'video/mp4':
            return 'Video';
        default:
            return 'Medya';
    }
}

export function buildConversationPreview(
    lastMessage: DirectConversationSummary['lastMessage'],
    currentUserId?: string,
) {
    if (!lastMessage) {
        return 'Ilk mesaji sen at.';
    }

    const prefix = lastMessage.senderId === currentUserId ? 'Sen: ' : '';
    const label = lastMessage.content?.trim()
        || (lastMessage.mediaMimeType ? getMediaLabel(lastMessage.mediaMimeType) : '')
        || (lastMessage.isEncrypted ? 'Sifreli mesaj' : 'Mesaj');
    return `${prefix}${label}`;
}

function compareMessages(left: LocalDirectMessage, right: LocalDirectMessage) {
    if (typeof left.sequence === 'number' && typeof right.sequence === 'number' && left.sequence !== right.sequence) {
        return left.sequence - right.sequence;
    }

    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);

    if (leftTime !== rightTime) {
        return leftTime - rightTime;
    }

    return left.id.localeCompare(right.id);
}

function areLastMessagesEqual(
    left: DirectConversationSummary['lastMessage'],
    right: DirectConversationSummary['lastMessage'],
) {
    if (left === right) {
        return true;
    }

    if (!left || !right) {
        return left === right;
    }

    return (
        left.id === right.id
        && left.senderId === right.senderId
        && left.content === right.content
        && left.isEncrypted === right.isEncrypted
        && left.mediaUrl === right.mediaUrl
        && left.mediaMimeType === right.mediaMimeType
        && left.createdAt === right.createdAt
    );
}

function areJsonWebKeysEqual(left?: JsonWebKey | null, right?: JsonWebKey | null) {
    if (left === right) {
        return true;
    }

    if (!left || !right) {
        return left === right;
    }

    return JSON.stringify(left) === JSON.stringify(right);
}

function areConversationSummariesEqual(left: DirectConversationSummary, right: DirectConversationSummary) {
    return (
        left.id === right.id
        && left.createdAt === right.createdAt
        && left.lastMessageAt === right.lastMessageAt
        && left.lastMessageSequence === right.lastMessageSequence
        && left.unreadCount === right.unreadCount
        && left.viewerLastDeliveredSequence === right.viewerLastDeliveredSequence
        && left.viewerLastSeenSequence === right.viewerLastSeenSequence
        && left.otherLastDeliveredSequence === right.otherLastDeliveredSequence
        && left.otherLastSeenSequence === right.otherLastSeenSequence
        && left.viewerLastReadAt === right.viewerLastReadAt
        && left.canMessage === right.canMessage
        && left.otherUserId === right.otherUserId
        && left.otherUsername === right.otherUsername
        && left.otherProfilePic === right.otherProfilePic
        && left.otherBio === right.otherBio
        && left.otherRole === right.otherRole
        && areJsonWebKeysEqual(left.otherDmPublicKey, right.otherDmPublicKey)
        && areLastMessagesEqual(left.lastMessage, right.lastMessage)
    );
}

export function mergeConversationSummary(
    base: DirectConversationSummary,
    incoming: Partial<DirectConversationSummary>
): DirectConversationSummary {
    const merged = {
        ...base,
        ...incoming,
        lastMessageSequence: Math.max(base.lastMessageSequence ?? 0, incoming.lastMessageSequence ?? 0),
        viewerLastDeliveredSequence: Math.max(base.viewerLastDeliveredSequence ?? 0, incoming.viewerLastDeliveredSequence ?? 0),
        viewerLastSeenSequence: Math.max(base.viewerLastSeenSequence ?? 0, incoming.viewerLastSeenSequence ?? 0),
        otherLastDeliveredSequence: Math.max(base.otherLastDeliveredSequence ?? 0, incoming.otherLastDeliveredSequence ?? 0),
        otherLastSeenSequence: Math.max(base.otherLastSeenSequence ?? 0, incoming.otherLastSeenSequence ?? 0),
        unreadCount: incoming.unreadCount ?? base.unreadCount,
        viewerLastReadAt: incoming.viewerLastReadAt ?? base.viewerLastReadAt,
        lastMessage: incoming.lastMessage ?? base.lastMessage,
    };

    return areConversationSummariesEqual(base, merged) ? base : merged;
}

export function upsertConversation(current: DirectConversationSummary[], incoming: DirectConversationSummary) {
    const existingIndex = current.findIndex((item) => item.id === incoming.id);
    const existing = existingIndex >= 0 ? current[existingIndex] : null;
    const merged = existing ? mergeConversationSummary(existing, incoming) : incoming;

    if (existing && merged === existing) {
        return current;
    }

    const next = existing
        ? current.map((item, index) => (index === existingIndex ? merged : item))
        : [merged, ...current];

    return next.sort((left, right) => {
        const leftTime = Date.parse(left.lastMessage?.createdAt ?? left.lastMessageAt);
        const rightTime = Date.parse(right.lastMessage?.createdAt ?? right.lastMessageAt);
        return rightTime - leftTime;
    });
}

export function patchConversation(
    current: DirectConversationSummary[],
    conversationId: string,
    patch: Partial<DirectConversationSummary>
) {
    let mutated = false;
    const next = current.map((item) => {
        if (item.id !== conversationId) {
            return item;
        }

        const merged = mergeConversationSummary(item, patch);
        if (merged !== item) {
            mutated = true;
        }
        return merged;
    });

    return mutated ? next : current;
}

export function mergeMessages(current: LocalDirectMessage[], incoming: LocalDirectMessage | LocalDirectMessage[]) {
    const next = [...current];
    const items = Array.isArray(incoming) ? incoming : [incoming];
    let mutated = false;

    for (const item of items) {
        const index = next.findIndex((candidate) => (
            candidate.id === item.id
            || (
                Boolean(candidate.clientMessageId)
                && Boolean(item.clientMessageId)
                && candidate.clientMessageId === item.clientMessageId
                && candidate.senderId === item.senderId
            )
        ));

        if (index === -1) {
            next.push(item);
            mutated = true;
            continue;
        }

        const currentItem = next[index];
        const mergedItem = {
            ...next[index],
            ...item,
            status: item.status ?? (item.sequence ? undefined : next[index].status),
            localId: next[index].localId ?? item.localId,
        };

        if (
            currentItem.id !== mergedItem.id
            || currentItem.sequence !== mergedItem.sequence
            || currentItem.clientMessageId !== mergedItem.clientMessageId
            || currentItem.content !== mergedItem.content
            || currentItem.isEncrypted !== mergedItem.isEncrypted
            || currentItem.mediaUrl !== mergedItem.mediaUrl
            || currentItem.mediaMimeType !== mergedItem.mediaMimeType
            || currentItem.createdAt !== mergedItem.createdAt
            || currentItem.status !== mergedItem.status
            || currentItem.localId !== mergedItem.localId
        ) {
            next[index] = mergedItem;
            mutated = true;
        }
    }

    if (!mutated) {
        return current;
    }

    next.sort(compareMessages);
    return next;
}

export function patchMessageStatus(current: LocalDirectMessage[], clientMessageId: string, status: 'sending' | 'failed') {
    let mutated = false;
    const next = current.map((item) => {
        if (item.clientMessageId !== clientMessageId || item.status === status) {
            return item;
        }

        mutated = true;
        return { ...item, status };
    });

    return mutated ? next : current;
}

export function patchFriendConversation(current: DirectFriend[], conversation: DirectConversationSummary) {
    let found = false;
    let mutated = false;

    const next = current.map((item) => {
        if (item.username !== conversation.otherUsername) {
            return item;
        }

        found = true;
        const updatedItem = {
            ...item,
            conversationId: conversation.id,
            lastMessageAt: conversation.lastMessage?.createdAt ?? conversation.lastMessageAt,
            unreadCount: conversation.unreadCount,
        };

        if (
            updatedItem.conversationId !== item.conversationId
            || updatedItem.lastMessageAt !== item.lastMessageAt
            || updatedItem.unreadCount !== item.unreadCount
        ) {
            mutated = true;
            return updatedItem;
        }

        return item;
    });

    return found && mutated ? next : current;
}

export function patchFriendUnread(current: DirectFriend[], conversationId: string, unreadCount: number) {
    let mutated = false;
    const next = current.map((item) => {
        if (item.conversationId !== conversationId || item.unreadCount === unreadCount) {
            return item;
        }

        mutated = true;
        return { ...item, unreadCount };
    });

    return mutated ? next : current;
}

export function readApiError(error: unknown, fallback: string) {
    const candidate = error as {
        message?: string;
        response?: {
            data?: {
                error?: string;
                detail?: string;
                details?: {
                    fieldErrors?: Record<string, string[] | undefined>;
                    formErrors?: string[];
                };
            };
        };
    };

    const responseData = candidate.response?.data;
    const formError = responseData?.details?.formErrors?.find(Boolean);
    if (formError) {
        return formError;
    }

    const fieldError = Object.values(responseData?.details?.fieldErrors ?? {})
        .flat()
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (fieldError) {
        return fieldError;
    }

    return responseData?.detail ?? responseData?.error ?? candidate.message ?? fallback;
}

export function getHighestSequence(messages: LocalDirectMessage[]) {
    return messages.reduce((highest, item) => (
        typeof item.sequence === 'number' && item.sequence > highest ? item.sequence : highest
    ), 0);
}

export function getLowestSequence(messages: LocalDirectMessage[]) {
    const sequenceValues = messages
        .map((item) => item.sequence)
        .filter((value): value is number => typeof value === 'number');

    if (sequenceValues.length === 0) {
        return null;
    }

    return Math.min(...sequenceValues);
}

export function isNearBottom(element: HTMLDivElement | null) {
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < 120;
}

export function buildConversationStatePatch(source: Record<string, unknown>) {
    const patch: Partial<DirectConversationSummary> = {};

    if (typeof source.unreadCount === 'number') patch.unreadCount = source.unreadCount;
    if (typeof source.lastMessageSequence === 'number') patch.lastMessageSequence = source.lastMessageSequence;
    if (typeof source.viewerLastDeliveredSequence === 'number') patch.viewerLastDeliveredSequence = source.viewerLastDeliveredSequence;
    if (typeof source.viewerLastSeenSequence === 'number') patch.viewerLastSeenSequence = source.viewerLastSeenSequence;
    if (typeof source.otherLastDeliveredSequence === 'number') patch.otherLastDeliveredSequence = source.otherLastDeliveredSequence;
    if (typeof source.otherLastSeenSequence === 'number') patch.otherLastSeenSequence = source.otherLastSeenSequence;
    if (typeof source.viewerLastReadAt === 'string') patch.viewerLastReadAt = source.viewerLastReadAt;

    return patch;
}

export function readVideoDuration(file: File) {
    return new Promise<number>((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const video = document.createElement('video');

        const cleanup = () => {
            URL.revokeObjectURL(objectUrl);
            video.removeAttribute('src');
            video.load();
        };

        video.preload = 'metadata';
        video.onloadedmetadata = () => {
            const duration = Number.isFinite(video.duration) ? video.duration : 0;
            cleanup();
            resolve(duration);
        };
        video.onerror = () => {
            cleanup();
            reject(new Error('Video metadata okunamadi.'));
        };
        video.src = objectUrl;
    });
}

export function buildOptimisticMessage(input: {
    conversationId: string;
    senderId: string;
    senderUsername: string;
    senderProfilePic: string | null;
    senderRole: 'admin' | 'elite' | 'pink' | 'user';
    content?: string;
    mediaUrl?: string | null;
    mediaMimeType?: string | null;
    clientMessageId: string;
}) {
    const now = new Date().toISOString();

    return {
        id: `local:${input.clientMessageId}`,
        localId: input.clientMessageId,
        conversationId: input.conversationId,
        senderId: input.senderId,
        senderUsername: input.senderUsername,
        senderProfilePic: input.senderProfilePic,
        senderRole: input.senderRole,
        clientMessageId: input.clientMessageId,
        content: input.content ?? null,
        isEncrypted: true,
        mediaUrl: input.mediaUrl ?? null,
        mediaMimeType: input.mediaMimeType ?? null,
        createdAt: now,
        status: 'sending' as const,
    };
}
