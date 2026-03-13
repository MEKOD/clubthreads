import { randomUUID } from "crypto";

export interface NotificationEvent {
    event: "notification:new" | "notification:read";
    userId: string;
    notificationType?: "follow" | "fav" | "reply" | "quote" | "rt" | "mention" | "community_invite" | "community_join_request";
    postId?: string;
    communitySlug?: string;
    actorId?: string;
    at: string;
}

type Listener = (payload: NotificationEvent) => void;
type PushDispatcher = (payload: NotificationEvent) => Promise<void>;

const listeners = new Map<string, Map<string, Listener>>();
let pushDispatcher: PushDispatcher | null = null;

export function setNotificationPushDispatcher(dispatcher: PushDispatcher | null): void {
    pushDispatcher = dispatcher;
}

export function subscribeToNotifications(userId: string, listener: Listener): () => void {
    const id = randomUUID();
    const current = listeners.get(userId) ?? new Map<string, Listener>();
    current.set(id, listener);
    listeners.set(userId, current);

    return () => {
        const bucket = listeners.get(userId);
        if (!bucket) return;
        bucket.delete(id);
        if (bucket.size === 0) listeners.delete(userId);
    };
}

export function publishNotificationEvent(payload: NotificationEvent): void {
    const bucket = listeners.get(payload.userId);

    if (bucket) {
        for (const listener of bucket.values()) {
            try {
                listener(payload);
            } catch {
                // Ignore broken listeners; connection cleanup is handled by route close hooks.
            }
        }
    }

    if (pushDispatcher && payload.event === "notification:new") {
        void pushDispatcher(payload).catch(() => {
            // Push delivery failures should never break request flow.
        });
    }
}

export function getNotificationListenerCount(): number {
    let total = 0;
    for (const bucket of listeners.values()) {
        total += bucket.size;
    }
    return total;
}

export function getActiveUserIds(): string[] {
    return Array.from(listeners.keys());
}
