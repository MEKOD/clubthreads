import { db } from "../db";
import { behavioralAnalyticsEvents } from "../db/schema";
import type { VisitorAnalyticsContext } from "./visitorAnalytics";

const METRIC_RETENTION_DAYS = 14;
const BEHAVIOR_RETENTION_DAYS = 30;

export interface RedisAnalyticsReader {
    hgetall: (key: string) => Promise<Record<string, string>>;
}

interface RedisAnalytics extends RedisAnalyticsReader {
    hincrby: (key: string, field: string, increment: number) => Promise<number | string>;
    hincrbyfloat: (key: string, field: string, increment: number) => Promise<number | string>;
    expire: (key: string, seconds: number) => Promise<number | string>;
}

export const behavioralEventTypes = [
    "session_start",
    "session_end",
    "screen_view",
    "feed_refresh",
    "post_impression",
    "post_dwell",
    "post_open",
    "post_share",
    "post_reply_start",
    "post_reply_submit",
    "post_repost",
    "post_quote",
    "post_like",
    "post_trash",
    "profile_view",
    "community_view",
    "search",
    "follow",
    "composer_open",
    "composer_submit",
] as const;

export type BehavioralEventType = (typeof behavioralEventTypes)[number];

export const behavioralEntityTypes = ["post", "user", "community", "screen", "search", "session"] as const;
export type BehavioralEntityType = (typeof behavioralEntityTypes)[number];

export interface BehavioralAnalyticsEvent {
    eventType: BehavioralEventType;
    surface: string;
    entityType?: BehavioralEntityType;
    entityId?: string;
    sessionId?: string;
    dwellMs?: number;
    searchQuery?: string;
    at?: string;
    visitorContext?: VisitorAnalyticsContext;
}

export interface RouteMetricPoint {
    route: string;
    count: number;
    avgMs: number;
    errors5xx: number;
}

export interface DailyMetricPoint {
    date: string;
    requests: number;
    errors4xx: number;
    errors5xx: number;
    avgLatencyMs: number;
    postsCreated: number;
    followsCreated: number;
    favsAdded: number;
    registrations: number;
    logins: number;
    notificationsEmitted: number;
    pushSent: number;
    pushFailed: number;
    pushStale: number;
}

export interface EntityBehaviorMetrics {
    entityId: string;
    eventsTotal: number;
    impressionCount: number;
    openCount: number;
    dwellCount: number;
    dwellTotalMs: number;
    replySubmitCount: number;
    repostCount: number;
    quoteCount: number;
    likeCount: number;
    trashCount: number;
}

function dayKey(date = new Date()): string {
    return date.toISOString().slice(0, 10);
}

function analyticsKey(date = new Date()): string {
    return `analytics:${dayKey(date)}`;
}

async function persistWindow(redis: RedisAnalytics, key: string): Promise<void> {
    await redis.expire(key, METRIC_RETENTION_DAYS * 24 * 60 * 60);
}

async function persistBehaviorWindow(redis: RedisAnalytics, key: string): Promise<void> {
    await redis.expire(key, BEHAVIOR_RETENTION_DAYS * 24 * 60 * 60);
}

function normalizeKeyPart(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 80) || "unknown";
}

function entityAnalyticsKey(entityType: BehavioralEntityType, entityId: string, date: Date): string {
    return `analytics:entity:${entityType}:${entityId}:${dayKey(date)}`;
}

function entityBehaviorMetricsEmpty(entityId: string): EntityBehaviorMetrics {
    return {
        entityId,
        eventsTotal: 0,
        impressionCount: 0,
        openCount: 0,
        dwellCount: 0,
        dwellTotalMs: 0,
        replySubmitCount: 0,
        repostCount: 0,
        quoteCount: 0,
        likeCount: 0,
        trashCount: 0,
    };
}

function resolveEventDate(event: BehavioralAnalyticsEvent): Date {
    if (event.at && !Number.isNaN(Date.parse(event.at))) {
        return new Date(event.at);
    }

    return new Date();
}

function normalizeOptionalText(value: string | undefined, maxLength: number): string | null {
    const normalized = value?.trim();
    if (!normalized) {
        return null;
    }

    return normalized.slice(0, maxLength);
}

export async function persistBehaviorBatch(
    userId: string,
    events: BehavioralAnalyticsEvent[]
): Promise<void> {
    await db.insert(behavioralAnalyticsEvents).values(
        events.map((event) => {
            const occurredAt = resolveEventDate(event);
            const dwellMs = Math.max(0, Math.min(300_000, Math.round(event.dwellMs ?? 0)));

            return {
                userId,
                eventType: event.eventType,
                surface: event.surface.trim().slice(0, 80),
                entityType: event.entityType ?? null,
                entityId: normalizeOptionalText(event.entityId, 160),
                sessionId: normalizeOptionalText(event.sessionId, 80),
                dwellMs: dwellMs > 0 ? dwellMs : null,
                searchQuery: normalizeOptionalText(event.searchQuery, 160),
                occurredAt,
                payload: {
                    ...event,
                    dwellMs,
                    at: occurredAt.toISOString(),
                },
            };
        })
    );
}

export async function incrementCounter(redis: RedisAnalytics, metric: string, increment = 1): Promise<void> {
    const key = analyticsKey();
    await redis.hincrby(key, metric, increment);
    await persistWindow(redis, key);
}

export async function trackBehaviorBatch(
    redis: RedisAnalytics,
    userId: string,
    events: BehavioralAnalyticsEvent[]
): Promise<void> {
    for (const event of events) {
        const eventDate = resolveEventDate(event);
        const dayAnalyticsKey = analyticsKey(eventDate);
        const surface = normalizeKeyPart(event.surface);
        const eventType = normalizeKeyPart(event.eventType);
        const sessionId = event.sessionId ? normalizeKeyPart(event.sessionId) : null;
        const dwellMs = Math.max(0, Math.min(300_000, Math.round(event.dwellMs ?? 0)));

        await Promise.all([
            redis.hincrby(dayAnalyticsKey, "behavior:events_total", 1),
            redis.hincrby(dayAnalyticsKey, `behavior:event:${eventType}`, 1),
            redis.hincrby(dayAnalyticsKey, `behavior:surface:${surface}:events`, 1),
            sessionId ? redis.hincrby(dayAnalyticsKey, `behavior:session:${sessionId}:events`, 1) : Promise.resolve(0),
            dwellMs > 0 ? redis.hincrby(dayAnalyticsKey, "behavior:dwell_total_ms", dwellMs) : Promise.resolve(0),
        ]);
        await persistBehaviorWindow(redis, dayAnalyticsKey);

        if (!event.entityType || !event.entityId) {
            continue;
        }

        const entityType = normalizeKeyPart(event.entityType) as BehavioralEntityType;
        const entityKey = entityAnalyticsKey(entityType, event.entityId, eventDate);

        await Promise.all([
            redis.hincrby(entityKey, "events_total", 1),
            redis.hincrby(entityKey, `event:${eventType}`, 1),
            redis.hincrby(entityKey, `surface:${surface}:events`, 1),
            redis.hincrby(entityKey, `user:${userId}:events`, 1),
            dwellMs > 0 ? redis.hincrby(entityKey, "dwell_total_ms", dwellMs) : Promise.resolve(0),
        ]);
        await persistBehaviorWindow(redis, entityKey);
    }
}

export async function trackRouteMetric(
    redis: RedisAnalytics,
    input: { route: string; latencyMs: number; statusCode: number }
): Promise<void> {
    const key = analyticsKey();
    const route = input.route.replaceAll(":", "_");

    await Promise.all([
        redis.hincrby(key, "requests_total", 1),
        redis.hincrbyfloat(key, "latency_total_ms", input.latencyMs),
        redis.hincrby(key, `route:${route}:count`, 1),
        redis.hincrbyfloat(key, `route:${route}:latency_total_ms`, input.latencyMs),
        input.statusCode >= 500 ? redis.hincrby(key, "errors_5xx", 1) : Promise.resolve(0),
        input.statusCode >= 400 && input.statusCode < 500 ? redis.hincrby(key, "errors_4xx", 1) : Promise.resolve(0),
        input.statusCode >= 500 ? redis.hincrby(key, `route:${route}:errors_5xx`, 1) : Promise.resolve(0),
    ]);

    await persistWindow(redis, key);
}

function parseNumberMap(record: Record<string, string>): Record<string, number> {
    return Object.fromEntries(
        Object.entries(record).map(([key, value]) => [key, Number(value) || 0])
    );
}

export async function getDailyMetrics(redis: RedisAnalyticsReader, days = 7): Promise<DailyMetricPoint[]> {
    const points: DailyMetricPoint[] = [];

    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - offset);
        const dateLabel = dayKey(date);
        const metrics = parseNumberMap(await redis.hgetall(`analytics:${dateLabel}`));
        const requests = metrics.requests_total ?? 0;

        points.push({
            date: dateLabel,
            requests,
            errors4xx: metrics.errors_4xx ?? 0,
            errors5xx: metrics.errors_5xx ?? 0,
            avgLatencyMs: requests > 0 ? Number(((metrics.latency_total_ms ?? 0) / requests).toFixed(1)) : 0,
            postsCreated: metrics.posts_created ?? 0,
            followsCreated: metrics.follows_created ?? 0,
            favsAdded: metrics.favs_added ?? 0,
            registrations: metrics.registrations ?? 0,
            logins: metrics.logins ?? 0,
            notificationsEmitted: metrics.notifications_emitted ?? 0,
            pushSent: metrics.push_sent ?? 0,
            pushFailed: metrics.push_failed ?? 0,
            pushStale: metrics.push_stale ?? 0,
        });
    }

    return points;
}

export async function getTopRoutes(redis: RedisAnalyticsReader, days = 1, limit = 8): Promise<RouteMetricPoint[]> {
    const aggregate = new Map<string, { count: number; latencyTotalMs: number; errors5xx: number }>();

    for (let offset = 0; offset < days; offset += 1) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - offset);
        const dateLabel = dayKey(date);
        const metrics = parseNumberMap(await redis.hgetall(`analytics:${dateLabel}`));

        for (const [key, value] of Object.entries(metrics)) {
            if (!key.startsWith("route:")) continue;
            const [, route, metric] = key.split(":");
            if (!route || !metric) continue;

            const current = aggregate.get(route) ?? { count: 0, latencyTotalMs: 0, errors5xx: 0 };
            if (metric === "count") current.count += value;
            if (metric === "latency_total_ms") current.latencyTotalMs += value;
            if (metric === "errors_5xx") current.errors5xx += value;
            aggregate.set(route, current);
        }
    }

    return [...aggregate.entries()]
        .map(([route, value]) => ({
            route: route.replaceAll("_", ":"),
            count: value.count,
            avgMs: value.count > 0 ? Number((value.latencyTotalMs / value.count).toFixed(1)) : 0,
            errors5xx: value.errors5xx,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

export async function getEntityBehaviorMetrics(
    redis: RedisAnalyticsReader,
    entityType: BehavioralEntityType,
    entityIds: string[],
    days = 7
): Promise<Map<string, EntityBehaviorMetrics>> {
    const uniqueEntityIds = [...new Set(entityIds.filter(Boolean))];
    const aggregates = new Map<string, EntityBehaviorMetrics>(
        uniqueEntityIds.map((entityId) => [entityId, entityBehaviorMetricsEmpty(entityId)])
    );

    if (uniqueEntityIds.length === 0 || days <= 0) {
        return aggregates;
    }

    const dayDates = Array.from({ length: days }, (_, offset) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - offset);
        return date;
    });

    const records = await Promise.all(
        uniqueEntityIds.flatMap((entityId) =>
            dayDates.map(async (date) => ({
                entityId,
                record: parseNumberMap(await redis.hgetall(entityAnalyticsKey(entityType, entityId, date))),
            }))
        )
    );

    for (const { entityId, record } of records) {
        const current = aggregates.get(entityId) ?? entityBehaviorMetricsEmpty(entityId);
        current.eventsTotal += record.events_total ?? 0;
        current.impressionCount += record["event:post_impression"] ?? 0;
        current.openCount += record["event:post_open"] ?? 0;
        current.dwellCount += record["event:post_dwell"] ?? 0;
        current.dwellTotalMs += record.dwell_total_ms ?? 0;
        current.replySubmitCount += record["event:post_reply_submit"] ?? 0;
        current.repostCount += record["event:post_repost"] ?? 0;
        current.quoteCount += record["event:post_quote"] ?? 0;
        current.likeCount += record["event:post_like"] ?? 0;
        current.trashCount += record["event:post_trash"] ?? 0;
        aggregates.set(entityId, current);
    }

    return aggregates;
}
