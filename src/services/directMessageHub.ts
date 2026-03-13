import { randomUUID } from "crypto";

export interface DirectMessageEvent {
    event: "dm:new" | "dm:read" | "dm:seen" | "dm:typing" | "dm:delivered";
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
    previewText?: string;
    clientMessageId?: string;
    originSessionId?: string;
    readerUserId?: string;
    readAt?: string;
    readThroughMessageId?: string;
    readThroughSequence?: number;
    deliveredThroughSequence?: number;
    seenThroughSequence?: number;
    message?: {
        id: string;
        conversationId: string;
        senderId: string;
        senderUsername: string;
        senderProfilePic: string | null;
        senderRole: "admin" | "elite" | "pink" | "user";
        sequence?: number;
        clientMessageId?: string | null;
        content: string | null;
        encryptedPayload?: Record<string, unknown> | null;
        isEncrypted?: boolean;
        mediaUrl?: string | null;
        mediaMimeType?: string | null;
        createdAt: string;
    };
    conversation?: {
        id: string;
        createdAt: string;
        lastMessageAt: string;
        lastMessageSequence?: number;
        unreadCount: number;
        viewerLastDeliveredSequence?: number;
        viewerLastSeenSequence?: number;
        otherLastDeliveredSequence?: number;
        otherLastSeenSequence?: number;
        canMessage: boolean;
        otherUserId: string;
        otherUsername: string;
        otherProfilePic: string | null;
        otherBio: string | null;
        otherRole: "admin" | "elite" | "pink" | "user";
        otherDmPublicKey?: Record<string, unknown> | null;
        lastMessage: {
            id: string;
            senderId: string | null;
            content: string | null;
            encryptedPayload?: Record<string, unknown> | null;
            isEncrypted?: boolean;
            mediaUrl?: string | null;
            mediaMimeType?: string | null;
            createdAt: string | null;
        } | null;
    };
    shouldPush?: boolean;
    at: string;
}

interface RedisPublisherLike {
    publish: (channel: string, message: string) => Promise<number>;
}

interface RedisSubscriberLike {
    subscribe: (channel: string) => Promise<unknown>;
    quit: () => Promise<unknown>;
    on: (event: "message", listener: (channel: string, payload: string) => void) => unknown;
    off?: (event: "message", listener: (channel: string, payload: string) => void) => unknown;
}

interface LoggerLike {
    warn: (meta: unknown, msg?: string) => void;
    error: (meta: unknown, msg?: string) => void;
}

type Listener = (payload: DirectMessageEvent) => void;
type PushDispatcher = (payload: DirectMessageEvent) => Promise<void>;

const CHANNEL = "club_threads:dm_events:v1";
const listeners = new Map<string, Map<string, Listener>>();

let publisher: RedisPublisherLike | null = null;
let subscriber: RedisSubscriberLike | null = null;
let logger: LoggerLike | null = null;
let pushDispatcher: PushDispatcher | null = null;
let started = false;
let onRedisMessage: ((channel: string, payload: string) => void) | null = null;

function deliverLocally(payload: DirectMessageEvent): void {
    const bucket = listeners.get(payload.userId);
    if (!bucket) return;

    for (const listener of bucket.values()) {
        try {
            listener(payload);
        } catch {
            // Broken listeners are cleaned up by the route close hook.
        }
    }
}

export async function startDirectMessageHub(opts: {
    publisher: RedisPublisherLike;
    subscriber: RedisSubscriberLike;
    logger?: LoggerLike;
}): Promise<void> {
    if (started) return;

    publisher = opts.publisher;
    subscriber = opts.subscriber;
    logger = opts.logger ?? null;

    onRedisMessage = (channel, payload) => {
        if (channel !== CHANNEL) return;

        try {
            const event = JSON.parse(payload) as DirectMessageEvent;
            deliverLocally(event);
        } catch (error) {
            logger?.warn({ err: error, channel }, "Failed to parse DM pub/sub payload");
        }
    };

    subscriber.on("message", onRedisMessage);
    await subscriber.subscribe(CHANNEL);
    started = true;
}

export async function stopDirectMessageHub(): Promise<void> {
    if (!started || !subscriber) return;

    if (onRedisMessage && subscriber.off) {
        subscriber.off("message", onRedisMessage);
    }

    await subscriber.quit().catch(() => undefined);
    subscriber = null;
    publisher = null;
    logger = null;
    onRedisMessage = null;
    started = false;
}

export function setDirectMessagePushDispatcher(dispatcher: PushDispatcher | null): void {
    pushDispatcher = dispatcher;
}

export function subscribeToDirectMessages(userId: string, listener: Listener): () => void {
    const id = randomUUID();
    const bucket = listeners.get(userId) ?? new Map<string, Listener>();
    bucket.set(id, listener);
    listeners.set(userId, bucket);

    return () => {
        const current = listeners.get(userId);
        if (!current) return;
        current.delete(id);
        if (current.size === 0) {
            listeners.delete(userId);
        }
    };
}

export function publishDirectMessageEvent(payload: DirectMessageEvent): void {
    if (pushDispatcher && payload.event === "dm:new" && payload.shouldPush === true) {
        void pushDispatcher(payload).catch((error) => {
            logger?.warn({ err: error, payload }, "DM push dispatch failed");
        });
    }

    if (!publisher) {
        deliverLocally(payload);
        return;
    }

    void publisher.publish(CHANNEL, JSON.stringify(payload)).catch((error) => {
        logger?.error({ err: error, payload }, "DM event publish failed; falling back to local delivery");
        deliverLocally(payload);
    });
}

export function getDirectMessageListenerCount(): number {
    let total = 0;
    for (const bucket of listeners.values()) {
        total += bucket.size;
    }
    return total;
}
