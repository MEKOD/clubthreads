import webpush from "web-push";
import { db } from "../db";
import { notifications } from "../db/schema";
import { and, eq, lte, sql } from "drizzle-orm";

interface RedisLike {
    hvals: (key: string) => Promise<string[]>;
    hdel: (key: string, ...fields: string[]) => Promise<number>;
    hincrby?: (key: string, field: string, increment: number) => Promise<number>;
    expire?: (key: string, seconds: number) => Promise<number>;
    get?: (key: string) => Promise<string | null>;
    set?: (...args: any[]) => Promise<unknown>;
}

interface LoggerLike {
    warn: (meta: unknown, msg?: string) => void;
    error: (meta: unknown, msg?: string) => void;
}

export interface PushPayload {
    title: string;
    body: string;
    url: string;
    icon?: string;
    badge?: string;
    tag?: string;
    requireInteraction?: boolean;
    renotify?: boolean;
    vibrate?: number[];
    data?: Record<string, unknown>;
}

function buildInteractiveDefaults() {
    return {
        requireInteraction: true,
        renotify: true,
        vibrate: [200, 100, 200],
    };
}

function buildUniqueTag(base: string, suffixParts: Array<string | undefined>): string {
    const suffix = suffixParts.filter(Boolean).join(":");
    return suffix ? `${base}:${suffix}` : `${base}:${Date.now()}`;
}

function trimPushPreview(text: string | undefined, max = 120): string | undefined {
    if (!text) return undefined;
    const normalized = text.trim().replace(/\s+/g, " ");
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

type StoredSubscription = {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
};

let isConfigured = false;
const PUSH_TTL_SECONDS = Math.min(Math.max(parseInt(process.env.WEB_PUSH_TTL_SECONDS ?? "900", 10), 60), 86_400);
const PUSH_URGENCY = process.env.WEB_PUSH_URGENCY === "very-low"
    || process.env.WEB_PUSH_URGENCY === "low"
    || process.env.WEB_PUSH_URGENCY === "normal"
    || process.env.WEB_PUSH_URGENCY === "high"
    ? process.env.WEB_PUSH_URGENCY
    : "high";
const REENGAGEMENT_BODIES = [
    "Kaptan ordunun sana ihtiyaci var!!",
    "Oguz cok enteresan bir post atti.",
    "Bizi ozlemedin mi ?",
];

function configureIfPossible(): boolean {
    if (isConfigured) return true;

    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!subject || !publicKey || !privateKey) {
        return false;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    isConfigured = true;
    return true;
}

async function recordPushMetric(
    redis: RedisLike,
    field: "push_sent" | "push_failed" | "push_stale"
): Promise<void> {
    if (!redis.hincrby || !redis.expire) return;
    const dateKey = new Date().toISOString().slice(0, 10);
    const key = `analytics:${dateKey}`;
    await redis.hincrby(key, field, 1);
    await redis.expire(key, 14 * 24 * 60 * 60);
}

export function getVapidPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
}

export async function sendWebPushToUser(
    redis: RedisLike,
    userId: string,
    payload: PushPayload,
    logger?: LoggerLike
): Promise<void> {
    if (!configureIfPossible()) {
        logger?.warn({ userId }, "web-push skipped: vapid not configured");
        return;
    }

    const key = `push_subscriptions:${userId}`;
    const members = await redis.hvals(key);
    if (members.length === 0) return;

    const staleEndpoints: string[] = [];
    const body = JSON.stringify(payload);

    await Promise.all(
        members.map(async (member) => {
            let subscription: StoredSubscription;
            try {
                subscription = JSON.parse(member) as StoredSubscription;
            } catch {
                return;
            }

            try {
                await webpush.sendNotification(subscription, body, {
                    TTL: PUSH_TTL_SECONDS,
                    urgency: PUSH_URGENCY,
                });
                await recordPushMetric(redis, "push_sent");
            } catch (err: any) {
                const statusCode = err?.statusCode;

                if (statusCode === 404 || statusCode === 410) {
                    staleEndpoints.push(subscription.endpoint);
                    await recordPushMetric(redis, "push_stale");
                    return;
                }
                await recordPushMetric(redis, "push_failed");
                logger?.warn({ err, userId }, "web-push send failed");
            }
        })
    );

    if (staleEndpoints.length > 0) {
        try {
            await redis.hdel(key, ...staleEndpoints);
        } catch (err) {
            logger?.error({ err, userId }, "web-push stale subscription cleanup failed");
        }
    }
}

function randomReengagementBody(): string {
    const idx = Math.floor(Math.random() * REENGAGEMENT_BODIES.length);
    return REENGAGEMENT_BODIES[idx] ?? REENGAGEMENT_BODIES[0];
}

export async function sendReengagementPushes(opts: {
    redis: RedisLike;
    logger?: LoggerLike;
    limit?: number;
    minHoursSinceLastUnread?: number;
    cooldownHours?: number;
    dryRun?: boolean;
}): Promise<{
    candidates: number;
    sent: number;
    skippedCooldown: number;
    dryRun: boolean;
}> {
    if (!configureIfPossible()) {
        return { candidates: 0, sent: 0, skippedCooldown: 0, dryRun: Boolean(opts.dryRun) };
    }

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const minHoursSinceLastUnread = Math.min(Math.max(opts.minHoursSinceLastUnread ?? 6, 1), 168);
    const cooldownHours = Math.min(Math.max(opts.cooldownHours ?? 24, 1), 168);
    const cutoff = new Date(Date.now() - minHoursSinceLastUnread * 60 * 60 * 1000);

    const rows = await db
        .select({
            userId: notifications.userId,
            unreadCount: sql<number>`COUNT(*)`,
        })
        .from(notifications)
        .where(and(eq(notifications.isRead, false), lte(notifications.createdAt, cutoff)))
        .groupBy(notifications.userId)
        .limit(limit);

    let sent = 0;
    let skippedCooldown = 0;

    for (const row of rows) {
        const cooldownKey = `push_reengage_cooldown:${row.userId}`;

        if (opts.redis.get) {
            const cooldown = await opts.redis.get(cooldownKey);
            if (cooldown) {
                skippedCooldown += 1;
                continue;
            }
        }

        if (opts.dryRun) continue;

        await sendWebPushToUser(
            opts.redis,
            row.userId,
            {
                title: "Club Threads seni bekliyor",
                body: row.unreadCount > 0
                    ? `${row.unreadCount} okunmamis bildirimin var. ${randomReengagementBody()}`
                    : randomReengagementBody(),
                url: "/notifications",
                tag: "reengagement",
            },
            opts.logger
        );

        if (opts.redis.set) {
            await opts.redis.set(cooldownKey, "1", "EX", cooldownHours * 60 * 60);
        }
        sent += 1;
    }

    return {
        candidates: rows.length,
        sent,
        skippedCooldown,
        dryRun: Boolean(opts.dryRun),
    };
}

export function payloadFromNotificationEvent(input: {
    notificationType?: "follow" | "fav" | "reply" | "quote" | "rt" | "mention" | "community_invite" | "community_join_request";
    postId?: string;
    communitySlug?: string;
    actorId?: string;
    at?: string;
}): PushPayload {
    const url = input.postId ? `/post/${input.postId}` : input.communitySlug ? `/communities/${input.communitySlug}` : "/notifications";
    const interactiveDefaults = buildInteractiveDefaults();
    const buildTag = (base: string) => buildUniqueTag(base, [
        input.postId,
        input.communitySlug,
        input.actorId,
        input.at ? Date.parse(input.at).toString() : undefined,
    ]);

    switch (input.notificationType) {
        case "follow":
            return {
                title: "Yeni takipci",
                body: "Biri seni takip etti.",
                url,
                tag: buildTag("notif-follow"),
                ...interactiveDefaults,
            };
        case "fav":
            return {
                title: "Yeni fav",
                body: "Postuna fav geldi.",
                url,
                tag: buildTag("notif-fav"),
                ...interactiveDefaults,
            };
        case "reply":
            return {
                title: "Yeni yorum",
                body: "Postuna yorum geldi.",
                url,
                tag: buildTag("notif-reply"),
                ...interactiveDefaults,
            };
        case "quote":
            return {
                title: "Yeni alinti",
                body: "Postun alintilandi.",
                url,
                tag: buildTag("notif-quote"),
                ...interactiveDefaults,
            };
        case "rt":
            return {
                title: "Yeni repost",
                body: "Postun yeniden paylasildi.",
                url,
                tag: buildTag("notif-rt"),
                ...interactiveDefaults,
            };
        case "mention":
            return {
                title: "Yeni mention",
                body: "Bir postta senden bahsedildi.",
                url,
                tag: buildTag("notif-mention"),
                ...interactiveDefaults,
            };
        case "community_invite":
            return {
                title: "Community daveti",
                body: "Bir community'ye davet edildin.",
                url,
                tag: buildTag("notif-community-invite"),
                ...interactiveDefaults,
            };
        case "community_join_request":
            return {
                title: "Yeni community istegi",
                body: "Bir kullanici community'ne katilmak istiyor.",
                url,
                tag: buildTag("notif-community-request"),
                ...interactiveDefaults,
            };
        default:
            return {
                title: "Yeni bildirim",
                body: "Hesabinda yeni bir hareket var.",
                url,
                tag: buildTag("notif-generic"),
                ...interactiveDefaults,
            };
    }
}

export function payloadFromDirectMessageEvent(input: {
    senderUsername?: string;
    counterpartyUsername?: string;
    previewText?: string;
    at?: string;
}): PushPayload {
    const interactiveDefaults = buildInteractiveDefaults();
    const senderLabel = input.senderUsername ? `@${input.senderUsername}` : "Birisi";
    const preview = trimPushPreview(input.previewText);

    return {
        title: senderLabel,
        body: preview ?? "Sana yeni bir mesaj gonderdi.",
        url: input.counterpartyUsername ? `/messages/${input.counterpartyUsername}` : "/messages",
        tag: buildUniqueTag("dm-message", [
            input.counterpartyUsername,
            input.senderUsername,
            input.at ? Date.parse(input.at).toString() : undefined,
        ]),
        ...interactiveDefaults,
    };
}
