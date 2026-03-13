import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/axios';
import { applyInteractionSnapshot, setInteractionSnapshot } from '../lib/interactionCache';
import { sharePostCard } from '../lib/shareCard';
import type { ParentPreview, TimelinePost } from '../lib/social';
import { isCacheFresh, useFeedCacheStore } from '../store/feedCacheStore';
import { trackAnalyticsEvent } from '../lib/analytics';
import { useVisibilityRefresh } from './useVisibilityRefresh';

export type CommunityFeedMode = 'latest' | 'popular' | 'trash';

const FEED_CACHE_TTL = 60 * 60_000;
const SILENT_REFRESH_MIN_INTERVAL = 45_000;

function mapTimelinePost(post: TimelinePost) {
    return {
        ...post,
        replyCount: post.replyCount ?? 0,
        viewCount: post.viewCount ?? 0,
    };
}

export function useCommunityFeedController(params: {
    slug: string;
    communityId?: string;
    communityName?: string;
}) {
    const { slug, communityId, communityName } = params;
    const cacheState = useFeedCacheStore.getState();
    const initialLatest = cacheState.communityLatestFeeds[slug];
    const initialPopular = cacheState.communityPopularFeeds[slug];
    const initialTrash = cacheState.communityTrashFeeds[slug];

    const [feedMode, setFeedMode] = useState<CommunityFeedMode>('latest');
    const [latestPosts, setLatestPosts] = useState<TimelinePost[]>(() =>
        initialLatest && isCacheFresh(initialLatest, FEED_CACHE_TTL) ? initialLatest.data.map(applyInteractionSnapshot) : []
    );
    const [popularPosts, setPopularPosts] = useState<TimelinePost[]>(() =>
        initialPopular && isCacheFresh(initialPopular, FEED_CACHE_TTL) ? initialPopular.data.map(applyInteractionSnapshot) : []
    );
    const [trashPosts, setTrashPosts] = useState<TimelinePost[]>(() =>
        initialTrash && isCacheFresh(initialTrash, FEED_CACHE_TTL) ? initialTrash.data.map(applyInteractionSnapshot) : []
    );
    const [isLoadingLatest, setIsLoadingLatest] = useState(() => !isCacheFresh(initialLatest, FEED_CACHE_TTL));
    const [isLoadingPopular, setIsLoadingPopular] = useState(() => !isCacheFresh(initialPopular, FEED_CACHE_TTL));
    const [isLoadingTrash, setIsLoadingTrash] = useState(() => !isCacheFresh(initialTrash, FEED_CACHE_TTL));
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(() =>
        initialLatest && isCacheFresh(initialLatest, FEED_CACHE_TTL) ? initialLatest.nextCursor : null
    );
    const [popularNextCursor, setPopularNextCursor] = useState<string | null>(() =>
        initialPopular && isCacheFresh(initialPopular, FEED_CACHE_TTL) ? initialPopular.nextCursor : null
    );
    const [trashNextCursor, setTrashNextCursor] = useState<string | null>(() =>
        initialTrash && isCacheFresh(initialTrash, FEED_CACHE_TTL) ? initialTrash.nextCursor : null
    );
    const [repostTargetId, setRepostTargetId] = useState<string | null>(null);
    const [quoteText, setQuoteText] = useState('');
    const [quoteGif, setQuoteGif] = useState<string | null>(null);
    const [isSubmittingRepost, setIsSubmittingRepost] = useState(false);
    const [isQuoteGifPickerOpen, setIsQuoteGifPickerOpen] = useState(false);

    const lastMutationAtRef = useRef(0);
    const lastSilentRefreshAtRef = useRef(0);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

    const hydrateParentPreviews = useCallback(async (items: TimelinePost[]) => {
        const parentIds = [...new Set(items.map((item) => item.parentId).filter((parentId): parentId is string => Boolean(parentId)))];
        if (parentIds.length === 0) {
            return items.map(applyInteractionSnapshot);
        }

        const currentPreviews = useFeedCacheStore.getState().parentPreviews;
        const missingParentIds = parentIds.filter((parentId) => !currentPreviews[parentId]);

        if (missingParentIds.length > 0) {
            try {
                const response = await api.post('/posts/batch-preview', { ids: missingParentIds });
                useFeedCacheStore.getState().mergeParentPreviews(response.data.previews as Record<string, ParentPreview>);
            } catch (error) {
                console.error('Batch parent preview fetch failed', error);
            }
        }

        const nextPreviews = useFeedCacheStore.getState().parentPreviews;
        return items.map((item) => ({
            ...item,
            parentPreview: item.parentId ? (nextPreviews[item.parentId] ?? null) : null,
        })).map(applyInteractionSnapshot);
    }, []);

    const syncLatestCache = useCallback((posts: TimelinePost[], cursor: string | null) => {
        useFeedCacheStore.getState().setCommunityLatestFeed(slug, {
            data: posts,
            nextCursor: cursor,
            fetchedAt: Date.now(),
        });
    }, [slug]);

    const syncPopularCache = useCallback((posts: TimelinePost[], cursor: string | null) => {
        useFeedCacheStore.getState().setCommunityPopularFeed(slug, {
            data: posts,
            nextCursor: cursor,
            fetchedAt: Date.now(),
        });
    }, [slug]);

    const syncTrashCache = useCallback((posts: TimelinePost[], cursor: string | null) => {
        useFeedCacheStore.getState().setCommunityTrashFeed(slug, {
            data: posts,
            nextCursor: cursor,
            fetchedAt: Date.now(),
        });
    }, [slug]);

    const fetchLatest = useCallback(async ({ silent = false, force = false }: { silent?: boolean; force?: boolean } = {}) => {
        if (!communityId) return;
        if (silent && Date.now() - lastMutationAtRef.current < 4000) return;
        if (silent && Date.now() - lastSilentRefreshAtRef.current < SILENT_REFRESH_MIN_INTERVAL) return;

        const existing = useFeedCacheStore.getState().communityLatestFeeds[slug];
        if (!force && !silent && existing && isCacheFresh(existing, FEED_CACHE_TTL)) {
            setLatestPosts(existing.data.map(applyInteractionSnapshot));
            setNextCursor(existing.nextCursor);
            setIsLoadingLatest(false);
            return;
        }

        if (!silent) setIsLoadingLatest(true);
        try {
            const response = await api.get(`/communities/${slug}/feed`);
            const hydrated = await hydrateParentPreviews((response.data.data ?? []).map(mapTimelinePost));
            const cursor = response.data.nextCursor ?? null;
            setLatestPosts(hydrated);
            setNextCursor(cursor);
            syncLatestCache(hydrated, cursor);
            trackAnalyticsEvent({ eventType: 'feed_refresh', surface: 'community_latest_feed', entityType: 'community', entityId: slug });
            if (silent) lastSilentRefreshAtRef.current = Date.now();
        } catch (error) {
            console.error('Community latest feed failed', error);
        } finally {
            if (!silent) setIsLoadingLatest(false);
        }
    }, [communityId, hydrateParentPreviews, slug, syncLatestCache]);

    const fetchPopular = useCallback(async (force = false) => {
        if (!communityId) return;
        const existing = useFeedCacheStore.getState().communityPopularFeeds[slug];
        if (!force && existing && isCacheFresh(existing, FEED_CACHE_TTL)) {
            setPopularPosts(existing.data.map(applyInteractionSnapshot));
            setPopularNextCursor(existing.nextCursor);
            setIsLoadingPopular(false);
            return;
        }

        setIsLoadingPopular(true);
        try {
            const response = await api.get(`/communities/${slug}/feed?mode=popular&limit=30`);
            const hydrated = await hydrateParentPreviews((response.data.data ?? []).map(mapTimelinePost));
            const cursor = response.data.nextCursor ?? null;
            setPopularPosts(hydrated);
            setPopularNextCursor(cursor);
            syncPopularCache(hydrated, cursor);
            trackAnalyticsEvent({ eventType: 'feed_refresh', surface: 'community_popular_feed', entityType: 'community', entityId: slug });
        } catch (error) {
            console.error('Community popular feed failed', error);
        } finally {
            setIsLoadingPopular(false);
        }
    }, [communityId, hydrateParentPreviews, slug, syncPopularCache]);

    const fetchTrash = useCallback(async (force = false) => {
        if (!communityId) return;
        const existing = useFeedCacheStore.getState().communityTrashFeeds[slug];
        if (!force && existing && isCacheFresh(existing, FEED_CACHE_TTL)) {
            setTrashPosts(existing.data.map(applyInteractionSnapshot));
            setTrashNextCursor(existing.nextCursor);
            setIsLoadingTrash(false);
            return;
        }

        setIsLoadingTrash(true);
        try {
            const response = await api.get(`/communities/${slug}/feed?mode=trash&limit=30`);
            const hydrated = await hydrateParentPreviews((response.data.data ?? []).map(mapTimelinePost));
            const cursor = response.data.nextCursor ?? null;
            setTrashPosts(hydrated);
            setTrashNextCursor(cursor);
            syncTrashCache(hydrated, cursor);
            trackAnalyticsEvent({ eventType: 'feed_refresh', surface: 'community_trash_feed', entityType: 'community', entityId: slug });
        } catch (error) {
            console.error('Community trash feed failed', error);
        } finally {
            setIsLoadingTrash(false);
        }
    }, [communityId, hydrateParentPreviews, slug, syncTrashCache]);

    const fetchMore = useCallback(async () => {
        if (isLoadingMore || !communityId) return;

        if (feedMode === 'latest') {
            if (!nextCursor) return;
            setIsLoadingMore(true);
            try {
                const response = await api.get(`/communities/${slug}/feed?cursor=${encodeURIComponent(nextCursor)}`);
                const hydrated = await hydrateParentPreviews((response.data.data ?? []).map(mapTimelinePost));
                const cursor = response.data.nextCursor ?? null;
                setLatestPosts((current) => {
                    const existingIds = new Set(current.map((post) => post.id));
                    const uniqueNew = hydrated.filter((post) => !existingIds.has(post.id));
                    const merged = [...current, ...uniqueNew];
                    syncLatestCache(merged, cursor);
                    return merged;
                });
                setNextCursor(cursor);
            } catch (error) {
                console.error('Community feed pagination failed', error);
            } finally {
                setIsLoadingMore(false);
            }
        } else if (feedMode === 'popular') {
            if (!popularNextCursor) return;
            setIsLoadingMore(true);
            try {
                const response = await api.get(`/communities/${slug}/feed?mode=popular&limit=30&offset=${encodeURIComponent(popularNextCursor)}`);
                const hydrated = await hydrateParentPreviews((response.data.data ?? []).map(mapTimelinePost));
                const cursor = response.data.nextCursor ?? null;
                setPopularPosts((current) => {
                    const existingIds = new Set(current.map((post) => post.id));
                    const uniqueNew = hydrated.filter((post) => !existingIds.has(post.id));
                    const merged = [...current, ...uniqueNew];
                    syncPopularCache(merged, cursor);
                    return merged;
                });
                setPopularNextCursor(cursor);
            } catch (error) {
                console.error('Community popular pagination failed', error);
            } finally {
                setIsLoadingMore(false);
            }
        } else if (feedMode === 'trash') {
            if (!trashNextCursor) return;
            setIsLoadingMore(true);
            try {
                const response = await api.get(`/communities/${slug}/feed?mode=trash&limit=30&offset=${encodeURIComponent(trashNextCursor)}`);
                const hydrated = await hydrateParentPreviews((response.data.data ?? []).map(mapTimelinePost));
                const cursor = response.data.nextCursor ?? null;
                setTrashPosts((current) => {
                    const existingIds = new Set(current.map((post) => post.id));
                    const uniqueNew = hydrated.filter((post) => !existingIds.has(post.id));
                    const merged = [...current, ...uniqueNew];
                    syncTrashCache(merged, cursor);
                    return merged;
                });
                setTrashNextCursor(cursor);
            } catch (error) {
                console.error('Community trash pagination failed', error);
            } finally {
                setIsLoadingMore(false);
            }
        }
    }, [communityId, feedMode, hydrateParentPreviews, isLoadingMore, nextCursor, popularNextCursor, slug, syncLatestCache, syncPopularCache, syncTrashCache, trashNextCursor]);

    useEffect(() => {
        void fetchLatest();
    }, [fetchLatest]);

    useEffect(() => {
        if (feedMode === 'popular' && popularPosts.length === 0) void fetchPopular();
        if (feedMode === 'trash' && trashPosts.length === 0) void fetchTrash();
    }, [feedMode, fetchPopular, fetchTrash, popularPosts.length, trashPosts.length]);

    useVisibilityRefresh(() => {
        void fetchLatest({ silent: true });
    }, { minHiddenMs: 12000 });

    const activeNextCursor = feedMode === 'popular' ? popularNextCursor : feedMode === 'trash' ? trashNextCursor : nextCursor;

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

    const applyUpdateAcrossFeeds = useCallback((postId: string, updater: (post: TimelinePost) => TimelinePost) => {
        const updateList = (list: TimelinePost[]) => list.map((post) => post.id === postId ? updater(post) : post);

        setLatestPosts((current) => {
            const next = updateList(current);
            syncLatestCache(next, useFeedCacheStore.getState().communityLatestFeeds[slug]?.nextCursor ?? nextCursor);
            return next;
        });
        setPopularPosts((current) => {
            const next = updateList(current);
            syncPopularCache(next, useFeedCacheStore.getState().communityPopularFeeds[slug]?.nextCursor ?? popularNextCursor);
            return next;
        });
        setTrashPosts((current) => {
            const next = updateList(current);
            syncTrashCache(next, useFeedCacheStore.getState().communityTrashFeeds[slug]?.nextCursor ?? trashNextCursor);
            return next;
        });
    }, [nextCursor, popularNextCursor, slug, syncLatestCache, syncPopularCache, syncTrashCache, trashNextCursor]);

    const handleInteract = useCallback(async (postId: string, type: 'fav' | 'trash') => {
        applyUpdateAcrossFeeds(postId, (post) => {
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

            setInteractionSnapshot(post.id, { favCount, trashCount, hasFav, hasTrash });
            return { ...post, favCount, trashCount, hasFav, hasTrash };
        });

        try {
            lastMutationAtRef.current = Date.now();
            await api.post(`/posts/${postId}/interact`, { type: type === 'fav' ? 'FAV' : 'TRASH' });
        } catch (error) {
            console.error('Interaction failed', error);
        }
    }, [applyUpdateAcrossFeeds]);

    const handleShare = useCallback(async (postId: string) => {
        try {
            await sharePostCard(postId, {
                title: communityName ? `/${slug}` : 'Community postu',
                text: communityName ? `${communityName} icinden bir post` : 'Community postu',
            });
        } catch (error) {
            console.error('Share failed', error);
        }
    }, [communityName, slug]);

    const handleRepost = useCallback((postId: string) => {
        trackAnalyticsEvent({
            eventType: 'post_repost',
            surface: 'community_feed',
            entityType: 'post',
            entityId: postId,
        });
        setRepostTargetId(postId);
        setQuoteText('');
        setQuoteGif(null);
        setIsQuoteGifPickerOpen(false);
    }, []);

    const closeRepostDialog = useCallback(() => {
        setRepostTargetId(null);
        setQuoteText('');
        setQuoteGif(null);
        setIsQuoteGifPickerOpen(false);
        setIsSubmittingRepost(false);
    }, []);

    const submitRepost = useCallback(async () => {
        if (!repostTargetId || isSubmittingRepost || !slug) return;
        setIsSubmittingRepost(true);
        applyUpdateAcrossFeeds(repostTargetId, (post) => ({ ...post, rtCount: (post.rtCount ?? 0) + 1 }));

        try {
            lastMutationAtRef.current = Date.now();
            await api.post(`/communities/${slug}/posts`, {
                type: (quoteText.trim() || quoteGif) ? 'quote' : 'rt',
                parentId: repostTargetId,
                content: quoteText.trim() || undefined,
                mediaUrl: quoteGif || undefined,
                mediaMimeType: quoteGif ? 'image/gif' : undefined,
            });
            trackAnalyticsEvent({
                eventType: (quoteText.trim() || quoteGif) ? 'post_quote' : 'post_repost',
                surface: 'community_feed',
                entityType: 'post',
                entityId: repostTargetId,
            });
            closeRepostDialog();
        } catch (error) {
            console.error('Repost failed', error);
            void fetchLatest({ force: true });
            void fetchPopular(true);
            void fetchTrash(true);
            setIsSubmittingRepost(false);
        }
    }, [applyUpdateAcrossFeeds, closeRepostDialog, fetchLatest, fetchPopular, fetchTrash, isSubmittingRepost, quoteGif, quoteText, repostTargetId, slug]);

    const prependPost = useCallback((post: TimelinePost) => {
        setLatestPosts((current) => {
            const next = [applyInteractionSnapshot(post), ...current];
            syncLatestCache(next, useFeedCacheStore.getState().communityLatestFeeds[slug]?.nextCursor ?? nextCursor);
            return next;
        });
        lastMutationAtRef.current = Date.now();
    }, [nextCursor, slug, syncLatestCache]);

    const repostTarget = useMemo(
        () => latestPosts.find((post) => post.id === repostTargetId)
            ?? popularPosts.find((post) => post.id === repostTargetId)
            ?? trashPosts.find((post) => post.id === repostTargetId)
            ?? null,
        [latestPosts, popularPosts, repostTargetId, trashPosts]
    );

    const displayPosts = feedMode === 'popular' ? popularPosts : feedMode === 'trash' ? trashPosts : latestPosts;
    const displayLoading = feedMode === 'popular' ? isLoadingPopular : feedMode === 'trash' ? isLoadingTrash : isLoadingLatest;

    return {
        feedMode,
        setFeedMode,
        displayPosts,
        displayLoading,
        isLoadingMore,
        nextCursor,
        activeNextCursor,
        loadMoreSentinelRef,
        handleInteract,
        handleShare,
        handleRepost,
        repostTarget,
        quoteText,
        setQuoteText,
        quoteGif,
        setQuoteGif,
        isQuoteGifPickerOpen,
        setIsQuoteGifPickerOpen,
        isSubmittingRepost,
        closeRepostDialog,
        submitRepost,
        prependPost,
    };
}
