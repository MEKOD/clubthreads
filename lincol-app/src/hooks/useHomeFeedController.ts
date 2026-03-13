import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/axios';
import { applyInteractionSnapshot, setInteractionSnapshot } from '../lib/interactionCache';
import { withViewTransition } from '../lib/navigation';
import { ensurePushSubscription, requestNotificationPermissionWithHint } from '../lib/push';
import { warmRouteModule } from '../lib/routeModules';
import type { ParentPreview, TimelinePost } from '../lib/social';
import { isCacheFresh, useFeedCacheStore } from '../store/feedCacheStore';
import { trackAnalyticsEvent } from '../lib/analytics';
import { useScrollRestoration } from './useScrollRestoration';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { addForYouPassiveSignalListener, type ForYouPassiveSignal } from '../lib/forYouFeedback';

export type FeedTab = 'for_you' | 'latest' | 'trash';

const DEFAULT_FEED_CACHE_TTL = 60 * 60_000;
const FOR_YOU_FEED_CACHE_TTL = 90_000;
const SILENT_REFRESH_MIN_INTERVAL = 45_000;
const MAX_FOR_YOU_EXPLORE_DEPTH = 4;
const FOR_YOU_DEPTH_RESET_MS = 15 * 60_000;
const FOR_YOU_PASSIVE_SIGNAL_WINDOW_MS = 90_000;
const FOR_YOU_PASSIVE_SIGNAL_THRESHOLD = 4;
const FOR_YOU_AUTO_REFRESH_TOP_THRESHOLD = 160;
const FOR_YOU_AUTO_REFRESH_COOLDOWN_MS = 20_000;
const HOME_TAB_SCROLL_PREFIX = 'home-tab:';

interface ComposePostedPreview {
    id: string;
    content: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
}

interface FeedControllerOptions {
    allowedTabs?: readonly FeedTab[];
    defaultTab?: FeedTab;
    persistedTabKey?: string;
    scrollStorageKeyPrefix?: string;
}

const DEFAULT_HOME_TABS: readonly FeedTab[] = ['for_you', 'trash'];

function getForYouPassiveSignalWeight(signal: ForYouPassiveSignal) {
    if (signal.kind === 'open') {
        return 3;
    }

    if ((signal.dwellMs ?? 0) >= 12_000) {
        return 3;
    }

    if ((signal.dwellMs ?? 0) >= 8_000) {
        return 2;
    }

    return 1;
}

export function useHomeFeedController(options: FeedControllerOptions = {}) {
    const navigate = useNavigate();
    const location = useLocation();
    const allowedTabs = options.allowedTabs ?? DEFAULT_HOME_TABS;
    const defaultTab = allowedTabs.includes(options.defaultTab ?? allowedTabs[0] ?? 'for_you')
        ? (options.defaultTab ?? allowedTabs[0] ?? 'for_you')
        : (allowedTabs[0] ?? 'for_you');
    const persistedTabKey = options.persistedTabKey ?? 'home-active-tab';
    const scrollStorageKeyPrefix = options.scrollStorageKeyPrefix ?? HOME_TAB_SCROLL_PREFIX;
    const {
        homeLatest,
        homeForYou,
        homeTrash,
        setHomeLatest,
        setHomeForYou,
        setHomeTrash,
        mergeParentPreviews,
    } = useFeedCacheStore.getState();

    const [activeTab, setActiveTabState] = useState<FeedTab>(() => {
        try {
            const saved = sessionStorage.getItem(persistedTabKey);
            if (saved === 'for_you' || saved === 'latest' || saved === 'trash') {
                return allowedTabs.includes(saved) ? saved : defaultTab;
            }
        } catch { }
        return defaultTab;
    });

    const setActiveTab = useCallback((tab: FeedTab) => {
        if (!allowedTabs.includes(tab)) {
            return;
        }
        try {
            sessionStorage.setItem(persistedTabKey, tab);
        } catch { }
        setActiveTabState(tab);
    }, [allowedTabs, persistedTabKey]);

    const [posts, setPosts] = useState<TimelinePost[]>(() =>
        homeLatest && isCacheFresh(homeLatest, DEFAULT_FEED_CACHE_TTL) ? homeLatest.data : []
    );
    const [forYouPosts, setForYouPosts] = useState<TimelinePost[]>(() =>
        homeForYou && isCacheFresh(homeForYou, FOR_YOU_FEED_CACHE_TTL) ? homeForYou.data : []
    );
    const [trashPosts, setTrashPosts] = useState<TimelinePost[]>(() =>
        homeTrash && isCacheFresh(homeTrash, DEFAULT_FEED_CACHE_TTL) ? homeTrash.data : []
    );
    const [isLoading, setIsLoading] = useState(() => !isCacheFresh(homeLatest, DEFAULT_FEED_CACHE_TTL));
    const [isLoadingForYou, setIsLoadingForYou] = useState(() => !isCacheFresh(homeForYou, FOR_YOU_FEED_CACHE_TTL));
    const [isLoadingTrash, setIsLoadingTrash] = useState(() => !isCacheFresh(homeTrash, DEFAULT_FEED_CACHE_TTL));
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(() =>
        homeLatest && isCacheFresh(homeLatest, DEFAULT_FEED_CACHE_TTL) ? homeLatest.nextCursor : null
    );
    const [forYouNextCursor, setForYouNextCursor] = useState<string | null>(() =>
        homeForYou && isCacheFresh(homeForYou, FOR_YOU_FEED_CACHE_TTL) ? homeForYou.nextCursor : null
    );
    const [trashNextCursor, setTrashNextCursor] = useState<string | null>(() =>
        homeTrash && isCacheFresh(homeTrash, DEFAULT_FEED_CACHE_TTL) ? homeTrash.nextCursor : null
    );
    const [repostTargetId, setRepostTargetId] = useState<string | null>(null);
    const [quoteText, setQuoteText] = useState('');
    const [quoteGif, setQuoteGif] = useState<string | null>(null);
    const [isQuoteGifPickerOpen, setIsQuoteGifPickerOpen] = useState(false);
    const [isSubmittingRepost, setIsSubmittingRepost] = useState(false);
    const [composePostedPreview, setComposePostedPreview] = useState<ComposePostedPreview | null>(null);
    const [notifHint, setNotifHint] = useState<string | null>(null);
    const [isEnablingNotif, setIsEnablingNotif] = useState(false);
    const [ptrProgress, setPtrProgress] = useState(0);
    const [isRefreshingFeed, setIsRefreshingFeed] = useState(false);

    const lastMutationAtRef = useRef(0);
    const lastSilentRefreshAtRef = useRef(0);
    const forYouExploreDepthRef = useRef(homeForYou?.exploreDepth ?? 0);
    const lastForYouRefreshAtRef = useRef(homeForYou?.fetchedAt ?? 0);
    const forYouPassiveScoreRef = useRef(0);
    const lastForYouPassiveSignalAtRef = useRef(0);
    const lastForYouAutoRefreshAtRef = useRef(0);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
    const ptrProgressRef = useRef(0);

    useEffect(() => {
        let startY = 0;
        let isPulling = false;
        let locked = false;

        const onTouchStart = (e: TouchEvent) => {
            if (window.scrollY > 0 || e.touches.length !== 1) return;
            startY = e.touches[0].clientY;
            isPulling = true;
            locked = false;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!isPulling) return;
            const y = e.touches[0].clientY;
            const delta = y - startY;

            if (delta <= 0 || window.scrollY > 0) {
                setPtrProgress(0);
                ptrProgressRef.current = 0;
                return;
            }

            const progress = Math.min(Math.max(delta - 12, 0) * 0.45, 72);
            ptrProgressRef.current = progress;
            setPtrProgress(progress);

            if (delta > 92) {
                locked = true;
            }
        };

        const onTouchEnd = () => {
            if (!isPulling) return;
            isPulling = false;
            const shouldRefresh = locked || ptrProgressRef.current > 54;
            setPtrProgress(0);
            ptrProgressRef.current = 0;
            if (shouldRefresh && !isRefreshingFeed) {
                window.dispatchEvent(new CustomEvent('refresh-feed'));
            }
        };

        document.addEventListener('touchstart', onTouchStart, { passive: true });
        document.addEventListener('touchmove', onTouchMove, { passive: true });
        document.addEventListener('touchend', onTouchEnd);
        document.addEventListener('touchcancel', onTouchEnd);

        return () => {
            document.removeEventListener('touchstart', onTouchStart);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
            document.removeEventListener('touchcancel', onTouchEnd);
        };
    }, [isRefreshingFeed]);

    const hydrateParentPreviews = useCallback(async (items: TimelinePost[]) => {
        // Seed cache with any server-provided previews
        const serverPreviews: Record<string, ParentPreview> = {};
        for (const item of items) {
            if (item.parentId && item.parentPreview) {
                serverPreviews[item.parentId] = item.parentPreview;
            }
        }
        if (Object.keys(serverPreviews).length > 0) {
            mergeParentPreviews(serverPreviews);
        }

        const parentIds = [...new Set(items.map((item) => item.parentId).filter((parentId): parentId is string => Boolean(parentId)))];
        if (parentIds.length === 0) {
            return items;
        }

        const currentPreviews = useFeedCacheStore.getState().parentPreviews;
        const missingParentIds = parentIds.filter((parentId) => !currentPreviews[parentId]);

        if (missingParentIds.length > 0) {
            try {
                const response = await api.post('/posts/batch-preview', { ids: missingParentIds });
                mergeParentPreviews(response.data.previews as Record<string, ParentPreview>);
            } catch (error) {
                console.error('Batch parent preview fetch failed', error);
            }
        }

        const nextPreviews = useFeedCacheStore.getState().parentPreviews;
        return items.map((item) => ({
            ...item,
            parentPreview: item.parentId ? (nextPreviews[item.parentId] ?? item.parentPreview ?? null) : null,
        })).map(applyInteractionSnapshot);
    }, [mergeParentPreviews]);

    const resetForYouExploreDepth = useCallback(() => {
        forYouExploreDepthRef.current = 0;
        lastForYouRefreshAtRef.current = Date.now();
        forYouPassiveScoreRef.current = 0;
        lastForYouPassiveSignalAtRef.current = 0;
    }, []);

    const resolveForYouExploreDepth = useCallback((advanceDepth: boolean) => {
        const now = Date.now();
        if (now - lastForYouRefreshAtRef.current > FOR_YOU_DEPTH_RESET_MS) {
            forYouExploreDepthRef.current = 0;
        }

        if (advanceDepth) {
            forYouExploreDepthRef.current = Math.min(MAX_FOR_YOU_EXPLORE_DEPTH, forYouExploreDepthRef.current + 1);
            lastForYouRefreshAtRef.current = now;
        }

        return forYouExploreDepthRef.current;
    }, []);

    const fetchFeed = useCallback(async ({ silent = false, force = false }: { silent?: boolean; force?: boolean } = {}) => {
        if (silent && Date.now() - lastMutationAtRef.current < 4000) return;
        if (silent && Date.now() - lastSilentRefreshAtRef.current < SILENT_REFRESH_MIN_INTERVAL) return;

        const latestCache = useFeedCacheStore.getState().homeLatest;
        if (!force && !silent && latestCache && isCacheFresh(latestCache, DEFAULT_FEED_CACHE_TTL)) {
            setPosts(latestCache.data.map(applyInteractionSnapshot));
            setNextCursor(latestCache.nextCursor);
            setIsLoading(false);
            return;
        }

        if (!silent) setIsLoading(true);
        try {
            const response = await api.get('/feed');
            const hydratedPosts = await hydrateParentPreviews(response.data.data ?? []);
            const cursor = response.data.nextCursor ?? null;
            setHomeLatest({ data: hydratedPosts, nextCursor: cursor, fetchedAt: Date.now() });
            setPosts(hydratedPosts);
            setNextCursor(cursor);
            trackAnalyticsEvent({ eventType: 'feed_refresh', surface: 'home_latest_feed' });
            if (silent) lastSilentRefreshAtRef.current = Date.now();
        } catch (error) {
            console.error('Error fetching feed:', error);
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [hydrateParentPreviews, setHomeLatest]);

    const fetchForYouFeed = useCallback(async ({ force = false, advanceDepth = false }: { force?: boolean; advanceDepth?: boolean } = {}) => {
        const forYouCache = useFeedCacheStore.getState().homeForYou;
        if (!force && forYouCache && isCacheFresh(forYouCache, FOR_YOU_FEED_CACHE_TTL)) {
            forYouExploreDepthRef.current = forYouCache.exploreDepth ?? 0;
            lastForYouRefreshAtRef.current = forYouCache.fetchedAt;
            setForYouPosts(forYouCache.data.map(applyInteractionSnapshot));
            setForYouNextCursor(forYouCache.nextCursor);
            setIsLoadingForYou(false);
            return;
        }
        setIsLoadingForYou(true);
        try {
            const exploreDepth = resolveForYouExploreDepth(advanceDepth);
            const response = await api.get(`/feed?mode=for_you&limit=30&refreshDepth=${encodeURIComponent(String(exploreDepth))}`);
            const hydratedPosts = await hydrateParentPreviews(response.data.data ?? []);
            const cursor = response.data.nextCursor ?? null;
            const fetchedAt = Date.now();
            forYouExploreDepthRef.current = exploreDepth;
            lastForYouRefreshAtRef.current = fetchedAt;
            forYouPassiveScoreRef.current = 0;
            lastForYouPassiveSignalAtRef.current = 0;
            setHomeForYou({ data: hydratedPosts, nextCursor: cursor, fetchedAt, exploreDepth });
            setForYouPosts(hydratedPosts);
            setForYouNextCursor(cursor);
            trackAnalyticsEvent({ eventType: 'feed_refresh', surface: 'home_for_you_feed' });
        } catch (error) {
            console.error('Error fetching for you feed:', error);
        } finally {
            setIsLoadingForYou(false);
        }
    }, [hydrateParentPreviews, resolveForYouExploreDepth, setHomeForYou]);

    const softenForYouExploreDepth = useCallback((refreshIfSafe = false) => {
        const currentDepth = forYouExploreDepthRef.current;
        if (currentDepth <= 0) {
            return;
        }

        const nextDepth = Math.max(0, currentDepth - 1);
        const now = Date.now();
        forYouExploreDepthRef.current = nextDepth;
        lastForYouRefreshAtRef.current = now;
        forYouPassiveScoreRef.current = 0;
        lastForYouPassiveSignalAtRef.current = now;

        const cacheState = useFeedCacheStore.getState();
        if (cacheState.homeForYou) {
            cacheState.setHomeForYou({
                ...cacheState.homeForYou,
                exploreDepth: nextDepth,
                fetchedAt: 0,
            });
        }

        if (
            refreshIfSafe &&
            activeTab === 'for_you' &&
            !isLoadingForYou &&
            !isRefreshingFeed &&
            typeof window !== 'undefined' &&
            window.scrollY <= FOR_YOU_AUTO_REFRESH_TOP_THRESHOLD &&
            now - lastForYouAutoRefreshAtRef.current > FOR_YOU_AUTO_REFRESH_COOLDOWN_MS
        ) {
            lastForYouAutoRefreshAtRef.current = now;
            void fetchForYouFeed({ force: true });
        }
    }, [activeTab, fetchForYouFeed, isLoadingForYou, isRefreshingFeed]);

    const fetchTrashFeed = useCallback(async (force = false) => {
        const trashCache = useFeedCacheStore.getState().homeTrash;
        if (!force && trashCache && isCacheFresh(trashCache, DEFAULT_FEED_CACHE_TTL)) {
            setTrashPosts(trashCache.data.map(applyInteractionSnapshot));
            setTrashNextCursor(trashCache.nextCursor);
            setIsLoadingTrash(false);
            return;
        }
        setIsLoadingTrash(true);
        try {
            const response = await api.get('/feed?mode=trash&limit=30');
            const hydratedPosts = await hydrateParentPreviews(response.data.data ?? []);
            const cursor = response.data.nextCursor ?? null;
            setHomeTrash({ data: hydratedPosts, nextCursor: cursor, fetchedAt: Date.now() });
            setTrashPosts(hydratedPosts);
            setTrashNextCursor(cursor);
            trackAnalyticsEvent({ eventType: 'feed_refresh', surface: 'home_trash_feed' });
        } catch (error) {
            console.error('Error fetching trash feed:', error);
        } finally {
            setIsLoadingTrash(false);
        }
    }, [hydrateParentPreviews, setHomeTrash]);

    const fetchMore = useCallback(async () => {
        if (isLoadingMore) return;

        if (activeTab === 'latest') {
            if (!nextCursor) return;
            setIsLoadingMore(true);
            try {
                const response = await api.get(`/feed?cursor=${encodeURIComponent(nextCursor)}`);
                const newPosts = await hydrateParentPreviews(response.data.data ?? []);
                const cursor = response.data.nextCursor ?? null;
                setPosts((current) => {
                    const existingIds = new Set(current.map((p) => p.id));
                    const uniqueNew = newPosts.filter((p) => !existingIds.has(p.id));
                    const merged = [...current, ...uniqueNew];
                    setHomeLatest({ data: merged, nextCursor: cursor, fetchedAt: Date.now() });
                    return merged;
                });
                setNextCursor(cursor);
            } catch (error) {
                console.error('Error loading more posts:', error);
            } finally {
                setIsLoadingMore(false);
            }
        } else if (activeTab === 'for_you') {
            if (!forYouNextCursor) return;
            setIsLoadingMore(true);
            try {
                const response = await api.get(
                    `/feed?mode=for_you&limit=30&offset=${encodeURIComponent(forYouNextCursor)}&refreshDepth=${encodeURIComponent(String(forYouExploreDepthRef.current))}`
                );
                const newPosts = await hydrateParentPreviews(response.data.data ?? []);
                const cursor = response.data.nextCursor ?? null;
                setForYouPosts((current) => {
                    const existingIds = new Set(current.map((p) => p.id));
                    const uniqueNew = newPosts.filter((p) => !existingIds.has(p.id));
                    const merged = [...current, ...uniqueNew];
                    setHomeForYou({
                        data: merged,
                        nextCursor: cursor,
                        fetchedAt: Date.now(),
                        exploreDepth: forYouExploreDepthRef.current,
                    });
                    return merged;
                });
                setForYouNextCursor(cursor);
            } catch (error) {
                console.error('Error loading more for you posts:', error);
            } finally {
                setIsLoadingMore(false);
            }
        } else if (activeTab === 'trash') {
            if (!trashNextCursor) return;
            setIsLoadingMore(true);
            try {
                const response = await api.get(`/feed?mode=trash&limit=30&offset=${encodeURIComponent(trashNextCursor)}`);
                const newPosts = await hydrateParentPreviews(response.data.data ?? []);
                const cursor = response.data.nextCursor ?? null;
                setTrashPosts((current) => {
                    const existingIds = new Set(current.map((p) => p.id));
                    const uniqueNew = newPosts.filter((p) => !existingIds.has(p.id));
                    const merged = [...current, ...uniqueNew];
                    setHomeTrash({ data: merged, nextCursor: cursor, fetchedAt: Date.now() });
                    return merged;
                });
                setTrashNextCursor(cursor);
            } catch (error) {
                console.error('Error loading more trash posts:', error);
            } finally {
                setIsLoadingMore(false);
            }
        }
    }, [activeTab, hydrateParentPreviews, isLoadingMore, nextCursor, forYouNextCursor, trashNextCursor, setHomeLatest, setHomeForYou, setHomeTrash]);

    const handleForceRefresh = useCallback(async () => {
        if (isRefreshingFeed) return;
        setIsRefreshingFeed(true);
        try {
            if (activeTab === 'latest') await fetchFeed({ force: true, silent: true });
            if (activeTab === 'for_you') await fetchForYouFeed({ force: true, advanceDepth: true });
            if (activeTab === 'trash') await fetchTrashFeed(true);
        } finally {
            window.setTimeout(() => setIsRefreshingFeed(false), 220);
        }
    }, [activeTab, fetchFeed, fetchForYouFeed, fetchTrashFeed, isRefreshingFeed]);

    const refreshActiveFeed = useCallback(async () => {
        if (activeTab === 'for_you') {
            resetForYouExploreDepth();
            await fetchForYouFeed({ force: true });
            return;
        }
        if (activeTab === 'trash') {
            await fetchTrashFeed(true);
            return;
        }
        await fetchFeed({ force: true, silent: true });
    }, [activeTab, fetchFeed, fetchForYouFeed, fetchTrashFeed, resetForYouExploreDepth]);

    useEffect(() => {
        window.addEventListener('refresh-feed', handleForceRefresh);
        return () => window.removeEventListener('refresh-feed', handleForceRefresh);
    }, [handleForceRefresh]);

    useEffect(() => {
        return addForYouPassiveSignalListener((signal) => {
            if (activeTab !== 'for_you' || forYouExploreDepthRef.current <= 0) {
                return;
            }

            const now = Date.now();
            if (now - lastForYouPassiveSignalAtRef.current > FOR_YOU_PASSIVE_SIGNAL_WINDOW_MS) {
                forYouPassiveScoreRef.current = 0;
            }

            lastForYouPassiveSignalAtRef.current = now;
            forYouPassiveScoreRef.current += getForYouPassiveSignalWeight(signal);

            if (forYouPassiveScoreRef.current >= FOR_YOU_PASSIVE_SIGNAL_THRESHOLD) {
                softenForYouExploreDepth(signal.kind === 'dwell');
            }
        });
    }, [activeTab, softenForYouExploreDepth]);

    useEffect(() => {
        if (activeTab === 'latest' && posts.length === 0) {
            void fetchFeed();
        } else if (activeTab === 'latest') {
            const latestCache = useFeedCacheStore.getState().homeLatest;
            if (latestCache && !isCacheFresh(latestCache, DEFAULT_FEED_CACHE_TTL)) {
                void fetchFeed({ force: true });
            }
        }
        if (activeTab === 'for_you' && forYouPosts.length === 0) {
            void fetchForYouFeed();
        } else if (activeTab === 'for_you') {
            const forYouCache = useFeedCacheStore.getState().homeForYou;
            if (forYouCache && !isCacheFresh(forYouCache, FOR_YOU_FEED_CACHE_TTL)) {
                void fetchForYouFeed({ force: true });
            }
        }
        if (activeTab === 'trash' && trashPosts.length === 0) {
            void fetchTrashFeed();
        } else if (activeTab === 'trash') {
            const trashCache = useFeedCacheStore.getState().homeTrash;
            if (trashCache && !isCacheFresh(trashCache, DEFAULT_FEED_CACHE_TTL)) {
                void fetchTrashFeed(true);
            }
        }
    }, [activeTab, fetchFeed, fetchForYouFeed, fetchTrashFeed, posts.length, forYouPosts.length, trashPosts.length]);

    useVisibilityRefresh(() => {
        if (activeTab === 'latest') {
            void fetchFeed({ silent: true });
            return;
        }
        if (activeTab === 'for_you') {
            void fetchForYouFeed();
            return;
        }
        void fetchTrashFeed();
    }, { minHiddenMs: 12000 });

    useEffect(() => {
        const navState = (location.state ?? {}) as { composePostedPreview?: ComposePostedPreview | null; composePostedAt?: number | null };
        const hasPreview = Boolean(navState.composePostedPreview && navState.composePostedAt);
        if (hasPreview) {
            setComposePostedPreview(navState.composePostedPreview ?? null);
            const timer = window.setTimeout(() => setComposePostedPreview(null), 2800);
            navigate(location.pathname, { replace: true, state: null });
            return () => window.clearTimeout(timer);
        }
    }, [location.pathname, location.state, navigate]);

    // Unified infinite scroll sentinel — works for all tabs
    const activeNextCursor = activeTab === 'for_you' ? forYouNextCursor : activeTab === 'trash' ? trashNextCursor : nextCursor;

    useEffect(() => {
        if (!activeNextCursor) return;
        const sentinel = loadMoreSentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) void fetchMore();
        }, { rootMargin: '400px' });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [fetchMore, activeNextCursor]);

    const handleInteract = useCallback(async (postId: string, type: 'fav' | 'trash') => {
        const applyUpdate = (currentPosts: TimelinePost[]) => currentPosts.map((post) => {
            if (post.id !== postId) return post;
            let favCount = post.favCount;
            let trashCount = post.trashCount;
            let hasFav = post.hasFav ?? false;
            let hasTrash = post.hasTrash ?? false;

            if (type === 'fav') {
                if (hasFav) {
                    favCount -= 1;
                    hasFav = false;
                } else {
                    favCount += 1;
                    hasFav = true;
                    if (hasTrash) {
                        trashCount -= 1;
                        hasTrash = false;
                    }
                }
            } else if (hasTrash) {
                trashCount -= 1;
                hasTrash = false;
            } else {
                trashCount += 1;
                hasTrash = true;
                if (hasFav) {
                    favCount -= 1;
                    hasFav = false;
                }
            }

            const nextPost = { ...post, favCount, trashCount, hasFav, hasTrash };
            setInteractionSnapshot(post.id, { favCount, trashCount, hasFav, hasTrash });
            return nextPost;
        });

        setPosts((current) => applyUpdate(current));
        setForYouPosts((current) => applyUpdate(current));
        setTrashPosts((current) => applyUpdate(current));
        resetForYouExploreDepth();

        const updateCache = (
            cache: { data: TimelinePost[]; fetchedAt: number; nextCursor: string | null; exploreDepth?: number } | null,
            nextExploreDepth?: number
        ) => cache ? {
            ...cache,
            data: cache.data.map((post) => (post.id === postId ? applyInteractionSnapshot({ ...post }) : post)),
            ...(typeof nextExploreDepth === 'number' ? { exploreDepth: nextExploreDepth } : {}),
        } : cache;

        const cacheState = useFeedCacheStore.getState();
        cacheState.setHomeLatest(updateCache(cacheState.homeLatest));
        cacheState.setHomeForYou(updateCache(cacheState.homeForYou, 0));
        cacheState.setHomeTrash(updateCache(cacheState.homeTrash));

        try {
            lastMutationAtRef.current = Date.now();
            await api.post(`/posts/${postId}/interact`, { type: type === 'fav' ? 'FAV' : 'TRASH' });
        } catch (error) {
            console.error('Interaction failed', error);
        }
    }, [resetForYouExploreDepth]);

    const handleShare = useCallback(async (postId: string) => {
        const shareUrl = `${window.location.origin}/post/${postId}`;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'Club Threads', text: 'Yer alti timeline\'dan bir parca.', url: shareUrl });
                return;
            }
            await navigator.clipboard.writeText(shareUrl);
        } catch (error) {
            console.error('Share failed', error);
        }
    }, []);

    const handleRepost = useCallback((postId: string) => {
        trackAnalyticsEvent({
            eventType: 'post_repost',
            surface: 'home_feed',
            entityType: 'post',
            entityId: postId,
        });
        setRepostTargetId(postId);
        setQuoteText('');
        setQuoteGif(null);
        setIsQuoteGifPickerOpen(false);
    }, []);

    const handleEnableNotifications = async () => {
        if (isEnablingNotif) return;
        setIsEnablingNotif(true);
        try {
            const result = await requestNotificationPermissionWithHint();
            setNotifHint(result.message ?? null);
            if (result.permission === 'granted') {
                await ensurePushSubscription();
                setComposePostedPreview(null);
            }
        } catch (error) {
            console.error('Notification permission request failed', error);
        } finally {
            setIsEnablingNotif(false);
        }
    };

    const openCompose = () => {
        warmRouteModule('compose');
        navigate('/compose', withViewTransition({ state: { returnTo: location.pathname, scrollY: window.scrollY } }));
    };

    const closeRepostDialog = () => {
        setRepostTargetId(null);
        setQuoteText('');
        setQuoteGif(null);
        setIsQuoteGifPickerOpen(false);
        setIsSubmittingRepost(false);
    };

    const submitRepost = async () => {
        if (!repostTargetId || isSubmittingRepost) return;
        const previousPosts = posts;
        const previousForYou = forYouPosts;
        const previousTrash = trashPosts;
        setIsSubmittingRepost(true);

        const updateRtCount = (currentPosts: TimelinePost[]) => currentPosts.map((post) =>
            post.id === repostTargetId ? { ...post, rtCount: (post.rtCount ?? 0) + 1 } : post
        );

        setPosts((current) => updateRtCount(current));
        setForYouPosts((current) => updateRtCount(current));
        setTrashPosts((current) => updateRtCount(current));

        const updateCache = (
            cache: { data: TimelinePost[]; fetchedAt: number; nextCursor: string | null; exploreDepth?: number } | null,
            nextExploreDepth?: number
        ) => cache ? {
            ...cache,
            data: updateRtCount(cache.data),
            ...(typeof nextExploreDepth === 'number' ? { exploreDepth: nextExploreDepth } : {}),
        } : cache;

        const cacheState = useFeedCacheStore.getState();
        cacheState.setHomeLatest(updateCache(cacheState.homeLatest));
        cacheState.setHomeForYou(updateCache(cacheState.homeForYou, 0));
        cacheState.setHomeTrash(updateCache(cacheState.homeTrash));

        try {
            lastMutationAtRef.current = Date.now();
            await api.post('/posts', {
                type: (quoteText.trim() || quoteGif) ? 'quote' : 'rt',
                parentId: repostTargetId,
                content: quoteText.trim() || undefined,
                mediaUrl: quoteGif || undefined,
                mediaMimeType: quoteGif ? 'image/gif' : undefined,
            });
            resetForYouExploreDepth();
            trackAnalyticsEvent({
                eventType: (quoteText.trim() || quoteGif) ? 'post_quote' : 'post_repost',
                surface: 'home_feed',
                entityType: 'post',
                entityId: repostTargetId,
            });
            closeRepostDialog();
        } catch (error) {
            console.error('Repost failed', error);
            setPosts(previousPosts);
            setForYouPosts(previousForYou);
            setTrashPosts(previousTrash);
            setIsSubmittingRepost(false);
        }
    };

    const repostTarget = useMemo(
        () => posts.find((post) => post.id === repostTargetId)
            ?? forYouPosts.find((post) => post.id === repostTargetId)
            ?? trashPosts.find((post) => post.id === repostTargetId)
            ?? null,
        [forYouPosts, posts, repostTargetId, trashPosts]
    );

    const displayPosts = activeTab === 'for_you' ? forYouPosts : activeTab === 'trash' ? trashPosts : posts;
    const displayLoading = activeTab === 'for_you' ? isLoadingForYou : activeTab === 'trash' ? isLoadingTrash : isLoading;

    const navState = (location.state ?? {}) as {
        composePostedPreview?: ComposePostedPreview | null;
        composePostedAt?: number | null;
        scrollY?: number;
    };

    // Stable content key that only changes on initial load or tab switch,
    // not on every fetchMore or silent refresh
    const scrollContentKey = `${activeTab}:${displayLoading ? 'loading' : 'ready'}`;

    useScrollRestoration({
        storageKey: `${scrollStorageKeyPrefix}${activeTab}`,
        ready: !displayLoading,
        contentKey: scrollContentKey,
        initialScrollY: navState.scrollY ?? null,
    });

    return {
        activeTab,
        setActiveTab,
        posts,
        displayPosts,
        displayLoading,
        forYouPosts,
        trashPosts,
        isLoadingMore,
        nextCursor,
        activeNextCursor,
        repostTarget,
        quoteText,
        setQuoteText,
        quoteGif,
        setQuoteGif,
        isQuoteGifPickerOpen,
        setIsQuoteGifPickerOpen,
        isSubmittingRepost,
        composePostedPreview,
        canShowNotifCTA: typeof Notification !== 'undefined' && Notification.permission === 'default',
        notifHint,
        isEnablingNotif,
        ptrProgress,
        isRefreshingFeed,
        loadMoreSentinelRef,
        handleInteract,
        handleShare,
        handleRepost,
        handleEnableNotifications,
        openCompose,
        closeRepostDialog,
        submitRepost,
        fetchFeed,
        refreshActiveFeed,
    };
}
