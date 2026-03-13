import { API_URL } from './axios';
import { useAuthStore } from '../store/authStore';

export type AnalyticsEventType =
    | 'session_start'
    | 'session_end'
    | 'screen_view'
    | 'feed_refresh'
    | 'post_impression'
    | 'post_dwell'
    | 'post_open'
    | 'post_share'
    | 'post_reply_start'
    | 'post_reply_submit'
    | 'post_repost'
    | 'post_quote'
    | 'post_like'
    | 'post_trash'
    | 'profile_view'
    | 'community_view'
    | 'search'
    | 'follow'
    | 'composer_open'
    | 'composer_submit';

export type AnalyticsEntityType = 'post' | 'user' | 'community' | 'screen' | 'search' | 'session';

export interface AnalyticsEventInput {
    eventType: AnalyticsEventType;
    surface: string;
    entityType?: AnalyticsEntityType;
    entityId?: string;
    dwellMs?: number;
    searchQuery?: string;
}

interface AnalyticsEventPayload extends AnalyticsEventInput {
    sessionId: string;
    at: string;
}

const SESSION_STORAGE_KEY = 'lincol-analytics-session-id';
const SESSION_STARTED_KEY = 'lincol-analytics-session-started';
const FLUSH_INTERVAL_MS = 8_000;
const MAX_BATCH_SIZE = 25;
const MAX_QUEUE_SIZE = 200;
const SEARCH_DEDUPE_WINDOW_MS = 10_000;
const MAX_SEARCH_QUERY_LENGTH = 160;
const MAX_SEARCH_ENTITY_ID_LENGTH = 120;

const queue: AnalyticsEventPayload[] = [];
const recentSearches = new Map<string, number>();
let flushTimer: number | null = null;
let lifecycleInstalled = false;
let sessionEndSent = false;

function nowIso() {
    return new Date().toISOString();
}

function safeRandomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getAnalyticsSessionId() {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) {
        return existing;
    }

    const next = safeRandomId();
    sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
}

function scheduleFlush() {
    if (flushTimer !== null) {
        return;
    }

    flushTimer = window.setTimeout(() => {
        flushTimer = null;
        void flushAnalytics();
    }, FLUSH_INTERVAL_MS);
}

async function postBatch(events: AnalyticsEventPayload[], useBeacon = false) {
    const token = useAuthStore.getState().token;
    if (!token || events.length === 0) {
        return;
    }

    const body = JSON.stringify({ events });

    const response = await fetch(`${API_URL}/analytics/batch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body,
        keepalive: useBeacon,
    });

    if (!response.ok) {
        throw new Error(`Analytics batch failed with status ${response.status}`);
    }
}

export async function flushAnalytics(options: { useBeacon?: boolean } = {}) {
    if (queue.length === 0) {
        return;
    }

    const events = queue.splice(0, MAX_BATCH_SIZE);
    try {
        await postBatch(events, options.useBeacon);
    } catch {
        queue.unshift(...events);
        if (queue.length > MAX_QUEUE_SIZE) {
            queue.splice(0, queue.length - MAX_QUEUE_SIZE);
        }
        scheduleFlush();
    }

    if (queue.length > 0) {
        scheduleFlush();
    }
}

export function trackAnalyticsEvent(event: AnalyticsEventInput) {
    const token = useAuthStore.getState().token;
    if (!token) {
        return;
    }

    queue.push({
        ...event,
        sessionId: getAnalyticsSessionId(),
        at: nowIso(),
    });

    if (queue.length >= MAX_BATCH_SIZE) {
        void flushAnalytics();
        return;
    }

    scheduleFlush();
}

function normalizeSearchQuery(query: string) {
    return query.trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_QUERY_LENGTH);
}

export function trackSearchEvent(input: { query: string; surface: string }) {
    const searchQuery = normalizeSearchQuery(input.query);
    if (searchQuery.length < 2) {
        return;
    }

    const dedupeKey = `${input.surface}:${searchQuery.toLowerCase()}`;
    const now = Date.now();
    const previousAt = recentSearches.get(dedupeKey);
    if (previousAt && now - previousAt < SEARCH_DEDUPE_WINDOW_MS) {
        return;
    }

    recentSearches.set(dedupeKey, now);
    if (recentSearches.size > 500) {
        for (const [key, trackedAt] of recentSearches.entries()) {
            if (now - trackedAt > SEARCH_DEDUPE_WINDOW_MS) {
                recentSearches.delete(key);
            }
        }
    }

    trackAnalyticsEvent({
        eventType: 'search',
        surface: input.surface,
        entityType: 'search',
        entityId: searchQuery.toLowerCase().slice(0, MAX_SEARCH_ENTITY_ID_LENGTH),
        searchQuery,
    });
}

export function inferAnalyticsSurface(pathname: string) {
    if (pathname === '/') return 'home_feed';
    if (pathname.startsWith('/post/')) return 'post_detail';
    if (pathname.startsWith('/users/')) return 'profile';
    if (pathname.startsWith('/communities/')) return 'community_detail';
    if (pathname === '/communities') return 'communities_hub';
    if (pathname === '/search') return 'discover';
    if (pathname === '/trends') return 'trends';
    if (pathname.startsWith('/topic/')) return 'topic_feed';
    if (pathname === '/compose') return 'compose';
    if (pathname === '/notifications') return 'notifications';
    if (pathname === '/settings') return 'settings';
    return 'app';
}

export function startAnalyticsSession() {
    const token = useAuthStore.getState().token;
    if (!token) {
        return;
    }

    const alreadyStarted = sessionStorage.getItem(SESSION_STARTED_KEY) === '1';
    if (alreadyStarted) {
        return;
    }

    sessionStorage.setItem(SESSION_STARTED_KEY, '1');
    sessionEndSent = false;
    trackAnalyticsEvent({
        eventType: 'session_start',
        surface: 'app_session',
        entityType: 'session',
        entityId: getAnalyticsSessionId(),
    });
}

export function endAnalyticsSession() {
    const token = useAuthStore.getState().token;
    const started = sessionStorage.getItem(SESSION_STARTED_KEY) === '1';
    if (!token || !started || sessionEndSent) {
        return;
    }

    sessionEndSent = true;
    queue.push({
        eventType: 'session_end',
        surface: 'app_session',
        entityType: 'session',
        entityId: getAnalyticsSessionId(),
        sessionId: getAnalyticsSessionId(),
        at: nowIso(),
    });
    void flushAnalytics({ useBeacon: true });
    sessionStorage.removeItem(SESSION_STARTED_KEY);
}

export function installAnalyticsLifecycle() {
    if (lifecycleInstalled) {
        return;
    }

    lifecycleInstalled = true;

    const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
            void flushAnalytics({ useBeacon: true });
        }
    };

    const handlePageHide = () => {
        endAnalyticsSession();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    window.setInterval(() => {
        void flushAnalytics();
    }, FLUSH_INTERVAL_MS);
}
