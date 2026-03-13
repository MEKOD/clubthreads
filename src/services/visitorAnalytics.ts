import type { FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db";

const ACTIVE_VISITOR_WINDOW_MINUTES = 15;

export interface VisitorAnalyticsContext {
    ipAddress: string | null;
    ipMasked: string | null;
    location: {
        country: string | null;
        region: string | null;
        city: string | null;
        district: string | null;
        neighborhood: string | null;
        postalCode: string | null;
        timezone: string | null;
        latitude: number | null;
        longitude: number | null;
        source: "edge_headers" | "unavailable";
        precision: "neighborhood" | "district" | "city" | "region" | "country" | "unknown";
    };
    device: {
        os: string;
        osVersion: string | null;
        browser: string;
        browserVersion: string | null;
        deviceType: "mobile" | "tablet" | "desktop" | "bot" | "unknown";
        vendor: string | null;
        model: string | null;
    };
    request: {
        userAgent: string | null;
        referer: string | null;
        host: string | null;
    };
}

export interface VisitorAnalyticsBucket {
    label: string;
    count: number;
}

export interface VisitorAnalyticsSession {
    userId: string;
    username: string;
    sessionId: string;
    firstSeenAt: string;
    lastSeenAt: string;
    eventCount: number;
    status: "active" | "idle" | "ended";
    country: string | null;
    region: string | null;
    city: string | null;
    district: string | null;
    neighborhood: string | null;
    postalCode: string | null;
    os: string | null;
    browser: string | null;
    browserVersion: string | null;
    deviceType: string | null;
    vendor: string | null;
    model: string | null;
    osVersion: string | null;
    userAgent: string | null;
    referer: string | null;
    host: string | null;
    ipAddress: string | null;
    ipMasked: string | null;
    lastSurface: string | null;
    lastPath: string | null;
    lastEventType: string | null;
}

export interface VisitorAnalyticsReport {
    overview: {
        days: number;
        activeWindowMinutes: number;
        visitors: number;
        sessions: number;
        activeNowUsers: number;
        activeNowSessions: number;
        endedSessions: number;
        avgEventsPerSession: number;
        cityResolvedSessions: number;
        districtResolvedSessions: number;
        deviceResolvedSessions: number;
        lastSeenAt: string | null;
    };
    locations: {
        countries: VisitorAnalyticsBucket[];
        regions: VisitorAnalyticsBucket[];
        cities: VisitorAnalyticsBucket[];
        districts: VisitorAnalyticsBucket[];
    };
    devices: {
        deviceTypes: VisitorAnalyticsBucket[];
        operatingSystems: VisitorAnalyticsBucket[];
        browsers: VisitorAnalyticsBucket[];
    };
    activeVisitors: VisitorAnalyticsSession[];
    recentVisitors: VisitorAnalyticsSession[];
}

function firstHeaderValue(request: FastifyRequest, names: string[]): string | null {
    for (const name of names) {
        const rawValue = request.headers[name];
        const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    }

    return null;
}

function normalizeText(value: string | null | undefined, maxLength: number): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }

    const normalized = trimmed.replace(/\s+/g, " ");
    if (!normalized || normalized.toLowerCase() === "unknown") {
        return null;
    }

    return normalized.slice(0, maxLength);
}

function normalizeCountry(value: string | null): string | null {
    const normalized = normalizeText(value, 80);
    if (!normalized || normalized === "XX" || normalized === "T1") {
        return null;
    }

    return normalized.length <= 3 ? normalized.toUpperCase() : normalized;
}

function normalizeVersion(value: string | null): string | null {
    const normalized = normalizeText(value, 32);
    return normalized ? normalized.replaceAll("_", ".") : null;
}

function parseCoordinate(value: string | null): number | null {
    if (!value) {
        return null;
    }

    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIpAddress(value: string | null): string | null {
    return normalizeText(value, 120);
}

function maskIpAddress(ip: string | null): string | null {
    const value = normalizeText(ip, 120);
    if (!value) {
        return null;
    }

    if (value.includes(".")) {
        const parts = value.split(".");
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
        }
    }

    if (value.includes(":")) {
        const parts = value.split(":").filter(Boolean);
        return parts.length > 0 ? `${parts.slice(0, 4).join(":")}::` : "xxxx::";
    }

    return `${value.slice(0, 6)}...`;
}

function parseUserAgent(userAgent: string | null): VisitorAnalyticsContext["device"] {
    const ua = userAgent ?? "";
    const lower = ua.toLowerCase();
    const isBot = /bot|crawl|spider|slurp|preview|facebookexternalhit|monitor/i.test(lower);

    const deviceType: VisitorAnalyticsContext["device"]["deviceType"] = isBot
        ? "bot"
        : /ipad|tablet|nexus 7|nexus 10|sm-t|kindle|silk/i.test(ua)
            ? "tablet"
            : /mobi|iphone|ipod|android.+mobile|windows phone|blackberry/i.test(lower)
                ? "mobile"
                : ua
                    ? "desktop"
                    : "unknown";

    const windowsMatch = ua.match(/Windows NT ([0-9.]+)/i);
    const androidMatch = ua.match(/Android ([0-9.]+)/i);
    const iosMatch = ua.match(/(?:CPU (?:iPhone )?OS|iPhone OS|CPU OS) ([0-9_]+)/i);
    const macMatch = ua.match(/Mac OS X ([0-9_]+)/i);
    const chromeOsMatch = ua.match(/CrOS [^ ]+ ([0-9.]+)/i);

    let os = "Unknown";
    let osVersion: string | null = null;

    if (androidMatch) {
        os = "Android";
        osVersion = normalizeVersion(androidMatch[1] ?? null);
    } else if (iosMatch) {
        os = /ipad/i.test(ua) ? "iPadOS" : "iOS";
        osVersion = normalizeVersion(iosMatch[1] ?? null);
    } else if (windowsMatch) {
        os = "Windows";
        osVersion = (() => {
            const version = windowsMatch[1];
            if (version === "10.0") return "10/11";
            if (version === "6.3") return "8.1";
            if (version === "6.2") return "8";
            if (version === "6.1") return "7";
            return normalizeVersion(version ?? null);
        })();
    } else if (chromeOsMatch) {
        os = "ChromeOS";
        osVersion = normalizeVersion(chromeOsMatch[1] ?? null);
    } else if (macMatch) {
        os = "macOS";
        osVersion = normalizeVersion(macMatch[1] ?? null);
    } else if (/linux/i.test(ua)) {
        os = "Linux";
    }

    const browserMatchers: Array<{ label: string; pattern: RegExp }> = [
        { label: "Edge", pattern: /Edg\/([0-9.]+)/i },
        { label: "Opera", pattern: /OPR\/([0-9.]+)/i },
        { label: "Samsung Internet", pattern: /SamsungBrowser\/([0-9.]+)/i },
        { label: "Chrome", pattern: /CriOS\/([0-9.]+)/i },
        { label: "Chrome", pattern: /Chrome\/([0-9.]+)/i },
        { label: "Firefox", pattern: /FxiOS\/([0-9.]+)/i },
        { label: "Firefox", pattern: /Firefox\/([0-9.]+)/i },
        { label: "Safari", pattern: /Version\/([0-9.]+).*Safari/i },
    ];

    let browser = isBot ? "Bot" : "Unknown";
    let browserVersion: string | null = null;

    for (const matcher of browserMatchers) {
        const match = ua.match(matcher.pattern);
        if (match) {
            browser = matcher.label;
            browserVersion = normalizeVersion(match[1] ?? null);
            break;
        }
    }

    let vendor: string | null = null;
    let model: string | null = null;

    if (/iphone/i.test(ua)) {
        vendor = "Apple";
        model = "iPhone";
    } else if (/ipad/i.test(ua)) {
        vendor = "Apple";
        model = "iPad";
    } else if (/macintosh|mac os x/i.test(ua)) {
        vendor = "Apple";
        model = "Mac";
    } else {
        const pixelMatch = ua.match(/Pixel ([^;)\]]+)/i);
        const samsungMatch = ua.match(/(SM-[A-Z0-9]+)/i);
        const xiaomiMatch = ua.match(/(Redmi [^;)\]]+|Mi [^;)\]]+)/i);

        if (pixelMatch) {
            vendor = "Google";
            model = normalizeText(pixelMatch[1] ?? null, 48);
        } else if (samsungMatch) {
            vendor = "Samsung";
            model = normalizeText(samsungMatch[1] ?? null, 48);
        } else if (xiaomiMatch) {
            vendor = "Xiaomi";
            model = normalizeText(xiaomiMatch[1] ?? null, 48);
        }
    }

    return {
        os,
        osVersion,
        browser,
        browserVersion,
        deviceType,
        vendor,
        model,
    };
}

export function buildVisitorAnalyticsContext(request: FastifyRequest): VisitorAnalyticsContext {
    const ip = normalizeIpAddress(firstHeaderValue(request, ["cf-connecting-ip", "x-forwarded-for"])?.split(",")[0]?.trim() ?? request.ip ?? null);
    const userAgent = normalizeText(firstHeaderValue(request, ["user-agent"]), 400);
    const device = parseUserAgent(userAgent);

    const country = normalizeCountry(firstHeaderValue(request, ["cf-ipcountry", "x-vercel-ip-country", "x-country-code", "x-country"]));
    const region = normalizeText(firstHeaderValue(request, ["x-vercel-ip-country-region", "x-region", "x-appengine-region", "cf-region", "cf-region-code"]), 120);
    const city = normalizeText(firstHeaderValue(request, ["x-vercel-ip-city", "x-city", "x-appengine-city", "cf-ipcity", "cf-city"]), 120);
    const district = normalizeText(firstHeaderValue(request, ["x-district", "x-geo-district", "cf-iplocality", "cf-district"]), 120);
    const neighborhood = normalizeText(firstHeaderValue(request, ["x-neighborhood", "x-geo-neighborhood"]), 120);
    const postalCode = normalizeText(firstHeaderValue(request, ["x-postal-code", "x-vercel-ip-postal-code", "cf-postal-code"]), 40);
    const timezone = normalizeText(firstHeaderValue(request, ["cf-timezone", "x-time-zone"]), 80);
    const latitude = parseCoordinate(firstHeaderValue(request, ["x-vercel-ip-latitude", "x-latitude"]));
    const longitude = parseCoordinate(firstHeaderValue(request, ["x-vercel-ip-longitude", "x-longitude"]));

    const precision: VisitorAnalyticsContext["location"]["precision"] = neighborhood
        ? "neighborhood"
        : district
            ? "district"
            : city
                ? "city"
                : region
                    ? "region"
                    : country
                        ? "country"
                        : "unknown";

    return {
        ipAddress: ip,
        ipMasked: maskIpAddress(ip),
        location: {
            country,
            region,
            city,
            district,
            neighborhood,
            postalCode,
            timezone,
            latitude,
            longitude,
            source: precision === "unknown" ? "unavailable" : "edge_headers",
            precision,
        },
        device,
        request: {
            userAgent,
            referer: normalizeText(firstHeaderValue(request, ["referer"]), 300),
            host: normalizeText(firstHeaderValue(request, ["host"]), 160),
        },
    };
}

function clampDays(days: number): number {
    if (!Number.isFinite(days)) {
        return 7;
    }

    return Math.min(30, Math.max(1, Math.round(days)));
}

function clampLimit(limit: number): number {
    if (!Number.isFinite(limit)) {
        return 50;
    }

    return Math.min(200, Math.max(1, Math.round(limit)));
}

function visitorSessionDataCte(days: number) {
    return sql`
        WITH filtered AS (
            SELECT
                user_id,
                session_id,
                event_type,
                surface,
                entity_type,
                entity_id,
                occurred_at,
                payload
            FROM behavioral_analytics_events
            WHERE occurred_at >= now() - make_interval(days => ${days})
              AND session_id IS NOT NULL
        ),
        session_rollup AS (
            SELECT
                user_id,
                session_id,
                MIN(occurred_at) AS first_seen_at,
                MAX(occurred_at) AS last_seen_at,
                COUNT(*)::int AS event_count,
                BOOL_OR(event_type = 'session_end') AS ended
            FROM filtered
            GROUP BY user_id, session_id
        ),
        latest_context AS (
            SELECT DISTINCT ON (user_id, session_id)
                user_id,
                session_id,
                NULLIF(payload->'visitorContext'->>'ipAddress', '') AS ip_address,
                NULLIF(payload->'visitorContext'->>'ipMasked', '') AS ip_masked,
                NULLIF(payload->'visitorContext'->'location'->>'country', '') AS country,
                NULLIF(payload->'visitorContext'->'location'->>'region', '') AS region,
                NULLIF(payload->'visitorContext'->'location'->>'city', '') AS city,
                NULLIF(payload->'visitorContext'->'location'->>'district', '') AS district,
                NULLIF(payload->'visitorContext'->'location'->>'neighborhood', '') AS neighborhood,
                NULLIF(payload->'visitorContext'->'location'->>'postalCode', '') AS postal_code,
                NULLIF(payload->'visitorContext'->'device'->>'os', '') AS os,
                NULLIF(payload->'visitorContext'->'device'->>'osVersion', '') AS os_version,
                NULLIF(payload->'visitorContext'->'device'->>'browser', '') AS browser,
                NULLIF(payload->'visitorContext'->'device'->>'browserVersion', '') AS browser_version,
                NULLIF(payload->'visitorContext'->'device'->>'deviceType', '') AS device_type,
                NULLIF(payload->'visitorContext'->'device'->>'vendor', '') AS vendor,
                NULLIF(payload->'visitorContext'->'device'->>'model', '') AS model,
                NULLIF(payload->'visitorContext'->'request'->>'userAgent', '') AS user_agent,
                NULLIF(payload->'visitorContext'->'request'->>'referer', '') AS referer,
                NULLIF(payload->'visitorContext'->'request'->>'host', '') AS host,
                NULLIF(surface, '') AS last_surface,
                NULLIF(event_type, '') AS last_event_type
            FROM filtered
            ORDER BY user_id, session_id, occurred_at DESC
        ),
        latest_screen AS (
            SELECT DISTINCT ON (user_id, session_id)
                user_id,
                session_id,
                NULLIF(entity_id, '') AS last_path
            FROM filtered
            WHERE entity_type = 'screen'
              AND entity_id IS NOT NULL
            ORDER BY user_id, session_id, occurred_at DESC
        ),
        session_data AS (
            SELECT
                rollup.user_id,
                users.username,
                rollup.session_id,
                rollup.first_seen_at,
                rollup.last_seen_at,
                rollup.event_count,
                rollup.ended,
                context.ip_address,
                context.ip_masked,
                context.country,
                context.region,
                context.city,
                context.district,
                context.neighborhood,
                context.postal_code,
                context.os,
                context.os_version,
                context.browser,
                context.browser_version,
                context.device_type,
                context.vendor,
                context.model,
                context.user_agent,
                context.referer,
                context.host,
                context.last_surface,
                screen.last_path,
                context.last_event_type
            FROM session_rollup AS rollup
            INNER JOIN users ON users.id = rollup.user_id
            LEFT JOIN latest_context AS context
                ON context.user_id = rollup.user_id AND context.session_id = rollup.session_id
            LEFT JOIN latest_screen AS screen
                ON screen.user_id = rollup.user_id AND screen.session_id = rollup.session_id
        )
    `;
}

function readNumber(value: unknown): number {
    if (typeof value === "number") {
        return value;
    }

    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
}

function readString(value: unknown): string | null {
    if (typeof value === "string") {
        return value.trim() ? value.trim() : null;
    }

    return null;
}

function readIsoTimestamp(value: unknown): string {
    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
            return date.toISOString();
        }
    }

    return new Date(0).toISOString();
}

async function getBuckets(days: number, expression: ReturnType<typeof sql>, limit: number): Promise<VisitorAnalyticsBucket[]> {
    const rows = await db.execute<{ label: string; count: number }>(sql`
        ${visitorSessionDataCte(days)}
        SELECT
            label,
            COUNT(*)::int AS count
        FROM (
            SELECT ${expression} AS label
            FROM session_data
        ) AS buckets
        WHERE label IS NOT NULL
          AND label <> ''
        GROUP BY label
        ORDER BY count DESC, label ASC
        LIMIT ${limit}
    `);

    return rows.rows.map((row) => ({
        label: row.label,
        count: readNumber(row.count),
    }));
}

async function getSessionRows(days: number, limit: number, onlyActive: boolean): Promise<VisitorAnalyticsSession[]> {
    const activeFilter = onlyActive
        ? sql`WHERE last_seen_at >= now() - make_interval(mins => ${ACTIVE_VISITOR_WINDOW_MINUTES}) AND ended = false`
        : sql``;

    const rows = await db.execute<{
        userId: string;
        username: string;
        sessionId: string;
        firstSeenAt: Date | string;
        lastSeenAt: Date | string;
        eventCount: number | string;
        status: "active" | "idle" | "ended";
        country: string | null;
        region: string | null;
        city: string | null;
        district: string | null;
        neighborhood: string | null;
        postalCode: string | null;
        os: string | null;
        osVersion: string | null;
        browser: string | null;
        browserVersion: string | null;
        deviceType: string | null;
        vendor: string | null;
        model: string | null;
        userAgent: string | null;
        referer: string | null;
        host: string | null;
        ipAddress: string | null;
        ipMasked: string | null;
        lastSurface: string | null;
        lastPath: string | null;
        lastEventType: string | null;
    }>(sql`
        ${visitorSessionDataCte(days)}
        SELECT
            user_id AS "userId",
            username,
            session_id AS "sessionId",
            first_seen_at AS "firstSeenAt",
            last_seen_at AS "lastSeenAt",
            event_count AS "eventCount",
            CASE
                WHEN ended THEN 'ended'
                WHEN last_seen_at >= now() - make_interval(mins => ${ACTIVE_VISITOR_WINDOW_MINUTES}) THEN 'active'
                ELSE 'idle'
            END AS status,
            country,
            region,
            city,
            district,
            neighborhood,
            postal_code AS "postalCode",
            os,
            os_version AS "osVersion",
            browser,
            browser_version AS "browserVersion",
            device_type AS "deviceType",
            vendor,
            model,
            user_agent AS "userAgent",
            referer,
            host,
            COALESCE(ip_address, ip_masked) AS "ipAddress",
            ip_masked AS "ipMasked",
            last_surface AS "lastSurface",
            last_path AS "lastPath",
            last_event_type AS "lastEventType"
        FROM session_data
        ${activeFilter}
        ORDER BY last_seen_at DESC
        LIMIT ${limit}
    `);

    return rows.rows.map((row) => ({
        userId: row.userId,
        username: row.username,
        sessionId: row.sessionId,
        firstSeenAt: readIsoTimestamp(row.firstSeenAt),
        lastSeenAt: readIsoTimestamp(row.lastSeenAt),
        eventCount: readNumber(row.eventCount),
        status: row.status,
        country: readString(row.country),
        region: readString(row.region),
        city: readString(row.city),
        district: readString(row.district),
        neighborhood: readString(row.neighborhood),
        postalCode: readString(row.postalCode),
        os: readString(row.os),
        osVersion: readString(row.osVersion),
        browser: readString(row.browser),
        browserVersion: readString(row.browserVersion),
        deviceType: readString(row.deviceType),
        vendor: readString(row.vendor),
        model: readString(row.model),
        userAgent: readString(row.userAgent),
        referer: readString(row.referer),
        host: readString(row.host),
        ipAddress: readString(row.ipAddress),
        ipMasked: readString(row.ipMasked),
        lastSurface: readString(row.lastSurface),
        lastPath: readString(row.lastPath),
        lastEventType: readString(row.lastEventType),
    }));
}

export async function getVisitorAnalyticsReport(input: { days?: number; limit?: number } = {}): Promise<VisitorAnalyticsReport> {
    const days = clampDays(input.days ?? 7);
    const limit = clampLimit(input.limit ?? 60);

    const [overviewResult, countries, regions, cities, districts, deviceTypes, operatingSystems, browsers, activeVisitors, recentVisitors] = await Promise.all([
        db.execute<{
            visitors: number | string;
            sessions: number | string;
            activeNowUsers: number | string;
            activeNowSessions: number | string;
            endedSessions: number | string;
            avgEventsPerSession: number | string;
            cityResolvedSessions: number | string;
            districtResolvedSessions: number | string;
            deviceResolvedSessions: number | string;
            lastSeenAt: Date | string | null;
        }>(sql`
            ${visitorSessionDataCte(days)}
            SELECT
                COUNT(DISTINCT user_id)::int AS visitors,
                COUNT(*)::int AS sessions,
                COUNT(DISTINCT user_id) FILTER (
                    WHERE last_seen_at >= now() - make_interval(mins => ${ACTIVE_VISITOR_WINDOW_MINUTES})
                      AND ended = false
                )::int AS "activeNowUsers",
                COUNT(*) FILTER (
                    WHERE last_seen_at >= now() - make_interval(mins => ${ACTIVE_VISITOR_WINDOW_MINUTES})
                      AND ended = false
                )::int AS "activeNowSessions",
                COUNT(*) FILTER (WHERE ended = true)::int AS "endedSessions",
                COALESCE(ROUND(AVG(event_count)::numeric, 1), 0)::float8 AS "avgEventsPerSession",
                COUNT(*) FILTER (WHERE city IS NOT NULL)::int AS "cityResolvedSessions",
                COUNT(*) FILTER (WHERE COALESCE(neighborhood, district) IS NOT NULL)::int AS "districtResolvedSessions",
                COUNT(*) FILTER (WHERE os IS NOT NULL OR browser IS NOT NULL OR device_type IS NOT NULL)::int AS "deviceResolvedSessions",
                MAX(last_seen_at) AS "lastSeenAt"
            FROM session_data
        `),
        getBuckets(days, sql`country`, 8),
        getBuckets(days, sql`region`, 8),
        getBuckets(days, sql`city`, 10),
        getBuckets(days, sql`COALESCE(neighborhood, district, postal_code)`, 10),
        getBuckets(days, sql`device_type`, 6),
        getBuckets(days, sql`os`, 8),
        getBuckets(days, sql`browser`, 8),
        getSessionRows(days, Math.min(limit, 12), true),
        getSessionRows(days, limit, false),
    ]);

    const overviewRow = overviewResult.rows[0];

    return {
        overview: {
            days,
            activeWindowMinutes: ACTIVE_VISITOR_WINDOW_MINUTES,
            visitors: readNumber(overviewRow?.visitors),
            sessions: readNumber(overviewRow?.sessions),
            activeNowUsers: readNumber(overviewRow?.activeNowUsers),
            activeNowSessions: readNumber(overviewRow?.activeNowSessions),
            endedSessions: readNumber(overviewRow?.endedSessions),
            avgEventsPerSession: readNumber(overviewRow?.avgEventsPerSession),
            cityResolvedSessions: readNumber(overviewRow?.cityResolvedSessions),
            districtResolvedSessions: readNumber(overviewRow?.districtResolvedSessions),
            deviceResolvedSessions: readNumber(overviewRow?.deviceResolvedSessions),
            lastSeenAt: overviewRow?.lastSeenAt ? readIsoTimestamp(overviewRow.lastSeenAt) : null,
        },
        locations: {
            countries,
            regions,
            cities,
            districts,
        },
        devices: {
            deviceTypes,
            operatingSystems,
            browsers,
        },
        activeVisitors,
        recentVisitors,
    };
}
