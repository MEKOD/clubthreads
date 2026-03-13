import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '../lib/axios';
import { applyInteractionSnapshot, setInteractionSnapshot } from '../lib/interactionCache';
import type { ParentPreview, TimelinePost } from '../lib/social';
import { PostCard } from '../components/feed/PostCard';
import { RepostComposerSheet } from '../components/feed/RepostComposerSheet';
import { isCacheFresh, useFeedCacheStore } from '../store/feedCacheStore';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';

const TOPIC_FEED_CACHE_TTL = 20_000;
const SILENT_REFRESH_MIN_INTERVAL = 15_000;
const ENABLE_SHARE_CARD = false;

export function TopicFeed() {
    const { topicFeeds, mergeParentPreviews, setTopicFeed } = useFeedCacheStore.getState();
    const { keyword: rawKeyword } = useParams<{ keyword: string }>();
    const location = useLocation();
    const getInitialKeyword = () => {
        const value = (rawKeyword ?? '').trim();
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    };

    const keyword = useMemo(getInitialKeyword, [rawKeyword]);

    const [posts, setPosts] = useState<TimelinePost[]>(() => {
        const kw = getInitialKeyword();
        const cache = topicFeeds[kw];
        return isCacheFresh(cache, TOPIC_FEED_CACHE_TTL) ? cache.data : [];
    });
    const [isLoading, setIsLoading] = useState(() => {
        const kw = getInitialKeyword();
        const cache = topicFeeds[kw];
        return !isCacheFresh(cache, TOPIC_FEED_CACHE_TTL);
    });
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(() => {
        const kw = getInitialKeyword();
        const cache = topicFeeds[kw];
        return isCacheFresh(cache, TOPIC_FEED_CACHE_TTL) ? cache.nextCursor : null;
    });

    const [repostTargetId, setRepostTargetId] = useState<string | null>(null);
    const [quoteText, setQuoteText] = useState('');
    const [quoteGif, setQuoteGif] = useState<string | null>(null);
    const [isQuoteGifPickerOpen, setIsQuoteGifPickerOpen] = useState(false);
    const [isSubmittingRepost, setIsSubmittingRepost] = useState(false);

    useBodyScrollLock(Boolean(repostTargetId));

    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
    const lastMutationAtRef = useRef(0);
    const lastSilentRefreshAtRef = useRef(0);
    const feedReqSeqRef = useRef(0);
    const keywordRef = useRef(keyword);

    useEffect(() => {
        keywordRef.current = keyword;
    }, [keyword]);

    const navState = (location.state ?? {}) as { scrollY?: number };

    useScrollRestoration({
        storageKey: `topic-scroll:${keyword}`,
        ready: !isLoading,
        contentKey: `${keyword}:${posts.length}:${nextCursor ?? 'end'}`,
        initialScrollY: navState.scrollY ?? null,
    });


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
                const previews = response.data.previews ?? {};
                mergeParentPreviews(previews as Record<string, ParentPreview>);
            } catch (error) {
                console.error('Batch parent preview fetch failed', error);
            }
        }

        const nextPreviews = useFeedCacheStore.getState().parentPreviews;
        return items
            .map((item) => ({
                ...item,
                parentPreview: item.parentId ? (nextPreviews[item.parentId] ?? null) : null,
            }))
            .map(applyInteractionSnapshot);
    }, [mergeParentPreviews]);

    const syncTopicCache = useCallback((topic: string, data: TimelinePost[], cursor: string | null) => {
        setTopicFeed(topic, {
            data,
            nextCursor: cursor,
            fetchedAt: Date.now(),
        });
    }, [setTopicFeed]);

    const fetchTopicFeed = useCallback(async (cursor?: string) => {
        const query = new URLSearchParams();
        query.set('limit', '30');
        if (cursor) query.set('cursor', cursor);

        const response = await api.get(`/trending/keywords/${encodeURIComponent(keyword)}/posts?${query.toString()}`);
        const hydrated = await hydrateParentPreviews(response.data.data ?? []);

        return {
            data: hydrated,
            nextCursor: response.data.nextCursor ?? null,
        };
    }, [hydrateParentPreviews, keyword]);

    const fetchInitial = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        const keywordForRequest = keyword;
        if (keywordForRequest.length < 2) {
            setPosts([]);
            setNextCursor(null);
            setIsLoading(false);
            return;
        }

        const cachedFeed = useFeedCacheStore.getState().topicFeeds[keywordForRequest];
        if (isCacheFresh(cachedFeed, TOPIC_FEED_CACHE_TTL)) {
            setPosts(cachedFeed.data.map(applyInteractionSnapshot));
            setNextCursor(cachedFeed.nextCursor);
            setIsLoading(false);
            return;
        }

        if (silent && Date.now() - lastSilentRefreshAtRef.current < SILENT_REFRESH_MIN_INTERVAL) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        const reqSeq = ++feedReqSeqRef.current;
        try {
            const result = await fetchTopicFeed();
            if (reqSeq !== feedReqSeqRef.current || keywordForRequest !== keywordRef.current) {
                return;
            }

            syncTopicCache(keywordForRequest, result.data, result.nextCursor);
            setPosts(result.data);
            setNextCursor(result.nextCursor);
            if (silent) {
                lastSilentRefreshAtRef.current = Date.now();
            }
        } catch (error) {
            if (reqSeq !== feedReqSeqRef.current || keywordForRequest !== keywordRef.current) {
                return;
            }
            console.error('Topic feed fetch failed', error);
            if (!silent) {
                setPosts([]);
                setNextCursor(null);
            }
        } finally {
            if (!silent) {
                setIsLoading(false);
            }
        }
    }, [fetchTopicFeed, keyword, syncTopicCache]);

    const fetchMore = useCallback(async () => {
        if (!nextCursor || isLoadingMore) {
            return;
        }

        const keywordForRequest = keyword;
        setIsLoadingMore(true);
        const reqSeq = ++feedReqSeqRef.current;
        try {
            const result = await fetchTopicFeed(nextCursor);
            if (reqSeq !== feedReqSeqRef.current || keywordForRequest !== keywordRef.current) {
                return;
            }

            setPosts((current) => {
                const existingIds = new Set(current.map((item) => item.id));
                const uniqueNew = result.data.filter((item) => !existingIds.has(item.id));
                const merged = [...current, ...uniqueNew];
                syncTopicCache(keywordForRequest, merged, result.nextCursor);
                return merged;
            });
            setNextCursor(result.nextCursor);
        } catch (error) {
            console.error('Topic feed load more failed', error);
        } finally {
            setIsLoadingMore(false);
        }
    }, [fetchTopicFeed, isLoadingMore, keyword, nextCursor, syncTopicCache]);

    useEffect(() => {
        void fetchInitial();
    }, [fetchInitial]);

    useVisibilityRefresh(() => {
        if (Date.now() - lastMutationAtRef.current < 4000) {
            return;
        }

        void fetchInitial({ silent: true });
    }, { minHiddenMs: 12000 });

    useEffect(() => {
        if (!nextCursor) {
            return;
        }

        const sentinel = loadMoreSentinelRef.current;
        if (!sentinel) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    void fetchMore();
                }
            },
            { rootMargin: '400px' }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [fetchMore, nextCursor]);

    const handleInteract = useCallback(async (postId: string, type: 'fav' | 'trash') => {

        setPosts((current) => {
            const updated = current.map((post) => {
                if (post.id !== postId) {
                    return post;
                }

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
                setInteractionSnapshot(post.id, {
                    favCount,
                    trashCount,
                    hasFav,
                    hasTrash,
                });
                return nextPost;
            });

            const existingCache = useFeedCacheStore.getState().topicFeeds[keywordRef.current];
            if (existingCache) {
                syncTopicCache(keywordRef.current, updated, existingCache.nextCursor);
            }
            return updated;
        });

        try {
            lastMutationAtRef.current = Date.now();
            await api.post(`/posts/${postId}/interact`, {
                type: type === 'fav' ? 'FAV' : 'TRASH',
            });
        } catch (error) {
            console.error('Interaction failed', error);
        }
    }, [syncTopicCache]);

    const handleShare = useCallback(async (postId: string) => {
        const shareUrl = `${window.location.origin}/post/${postId}`;

        try {
            if (ENABLE_SHARE_CARD) {
                const { sharePostCard } = await import('../lib/shareCard');
                await sharePostCard(postId, {
                    title: `#${keywordRef.current}`,
                    text: 'Club Threads postu',
                });
                return;
            }

            if (navigator.share) {
                await navigator.share({
                    title: `#${keywordRef.current}`,
                    text: 'Club Threads postu',
                    url: shareUrl,
                });
                return;
            }

            await navigator.clipboard.writeText(shareUrl);
        } catch (error) {
            console.error('Share failed', error);
        }
    }, []);

    const handleRepost = async (postId: string) => {
        setRepostTargetId(postId);
        setQuoteText('');
        setQuoteGif(null);
        setIsQuoteGifPickerOpen(false);
    };

    const closeRepostDialog = () => {
        setRepostTargetId(null);
        setQuoteText('');
        setQuoteGif(null);
        setIsQuoteGifPickerOpen(false);
        setIsSubmittingRepost(false);
    };

    const submitRepost = async () => {
        if (!repostTargetId || isSubmittingRepost) {
            return;
        }

        setIsSubmittingRepost(true);

        const previousPosts = posts;
        const updatedPosts = posts.map((post) =>
            post.id === repostTargetId ? { ...post, rtCount: (post.rtCount ?? 0) + 1 } : post
        );
        setPosts(updatedPosts);
        syncTopicCache(keyword, updatedPosts, nextCursor);

        try {
            lastMutationAtRef.current = Date.now();
            await api.post('/posts', {
                type: (quoteText.trim() || quoteGif) ? 'quote' : 'rt',
                parentId: repostTargetId,
                content: quoteText.trim() || undefined,
                mediaUrl: quoteGif || undefined,
                mediaMimeType: quoteGif ? 'image/gif' : undefined,
            });
            closeRepostDialog();
        } catch (error) {
            console.error('Repost failed', error);
            setPosts(previousPosts);
            syncTopicCache(keyword, previousPosts, nextCursor);
            setIsSubmittingRepost(false);
        }
    };

    const repostTarget = useMemo(
        () => posts.find((post) => post.id === repostTargetId) ?? null,
        [posts, repostTargetId]
    );

    return (
        <div className="min-h-screen border-x border-border bg-bg-primary">
            <RepostComposerSheet
                open={Boolean(repostTarget)}
                target={repostTarget}
                quoteText={quoteText}
                onQuoteTextChange={setQuoteText}
                quoteGif={quoteGif}
                onQuoteGifChange={setQuoteGif}
                gifPickerOpen={isQuoteGifPickerOpen}
                onGifPickerOpenChange={setIsQuoteGifPickerOpen}
                isSubmitting={isSubmittingRepost}
                onClose={closeRepostDialog}
                onSubmit={submitRepost}
            />

            <div className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))] z-10 border-b border-border bg-bg-primary/95 px-4 py-3 backdrop-blur md:top-0">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">Su an konusulan</div>
                <h1 className="mt-1 text-xl font-extrabold text-text-primary">#{keyword || 'trend'}</h1>
            </div>

            {isLoading ? (
                <div className="flex min-h-[40vh] items-center justify-center text-text-secondary">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            ) : posts.length === 0 ? (
                <div className="px-6 py-14 text-center text-sm text-text-secondary">Bu kelime icin post bulunamadi.</div>
            ) : (
                <div>
                    {posts.map((post) => (
                        <PostCard
                            key={post.id}
                            post={post}
                            onInteract={handleInteract}
                            onRepost={handleRepost}
                            onShare={handleShare}
                        />
                    ))}

                    <div ref={loadMoreSentinelRef} className="h-16" />

                    {isLoadingMore && (
                        <div className="flex items-center justify-center pb-6 text-text-secondary">
                            <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
