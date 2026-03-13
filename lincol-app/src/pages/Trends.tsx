import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Loader2, TrendingUp } from 'lucide-react';
import { api } from '../lib/axios';
import { applyInteractionSnapshot, setInteractionSnapshot } from '../lib/interactionCache';
import { formatTrendingKeyword, type ParentPreview, type TimelinePost, type TrendingKeyword } from '../lib/social';
import { PostCard } from '../components/feed/PostCard';
import { RepostComposerSheet } from '../components/feed/RepostComposerSheet';
import { isCacheFresh, useFeedCacheStore } from '../store/feedCacheStore';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';

const KEYWORDS_CACHE_TTL = 30_000;
const FEED_CACHE_TTL = 20_000;
const SILENT_REFRESH_MIN_INTERVAL = 15_000;
const ENABLE_SHARE_CARD = false;

export function Trends() {
    const { trendsKeywords, trendFeeds, setTrendsKeywords, setTrendFeed, mergeParentPreviews } = useFeedCacheStore.getState();
    const location = useLocation();
    const [keywords, setKeywords] = useState<TrendingKeyword[]>(() =>
        trendsKeywords && isCacheFresh(trendsKeywords, KEYWORDS_CACHE_TTL)
            ? trendsKeywords.data
            : []
    );
    const [selectedKeyword, setSelectedKeyword] = useState<string>(() =>
        trendsKeywords?.data[0]?.keyword ?? ''
    );
    const [posts, setPosts] = useState<TimelinePost[]>(() => {
        const keyword = trendsKeywords?.data[0]?.keyword ?? '';
        const cache = trendFeeds[keyword];
        return isCacheFresh(cache, FEED_CACHE_TTL) ? cache.data : [];
    });

    const [isLoadingKeywords, setIsLoadingKeywords] = useState(keywords.length === 0);
    const [isLoadingFeed, setIsLoadingFeed] = useState(posts.length === 0);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(() => {
        const keyword = trendsKeywords?.data[0]?.keyword ?? '';
        const cache = trendFeeds[keyword];
        return isCacheFresh(cache, FEED_CACHE_TTL) ? cache.nextCursor : null;
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
    const keywordsReqSeqRef = useRef(0);
    const feedReqSeqRef = useRef(0);
    const selectedKeywordRef = useRef(selectedKeyword);

    useEffect(() => {
        selectedKeywordRef.current = selectedKeyword;
    }, [selectedKeyword]);

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

    const syncFeedCache = useCallback((keyword: string, data: TimelinePost[], cursor: string | null) => {
        setTrendFeed(keyword, {
            data,
            nextCursor: cursor,
            fetchedAt: Date.now(),
        });
    }, [setTrendFeed]);

    const fetchKeywords = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        const keywordsCache = useFeedCacheStore.getState().trendsKeywords;
        if (keywordsCache && isCacheFresh(keywordsCache, KEYWORDS_CACHE_TTL)) {
            setKeywords(keywordsCache.data);
            setSelectedKeyword((current) =>
                current && keywordsCache.data.some((item) => item.keyword === current)
                    ? current
                    : keywordsCache.data[0]?.keyword ?? ''
            );
            setIsLoadingKeywords(false);
            return;
        }

        if (silent && Date.now() - lastSilentRefreshAtRef.current < SILENT_REFRESH_MIN_INTERVAL) {
            return;
        }

        if (!silent) {
            setIsLoadingKeywords(true);
        }

        const reqSeq = ++keywordsReqSeqRef.current;
        try {
            const response = await api.get('/trending/keywords?window=6h&limit=15');
            if (reqSeq !== keywordsReqSeqRef.current) {
                return;
            }

            const nextKeywords: TrendingKeyword[] = response.data.keywords ?? [];

            setTrendsKeywords({
                data: nextKeywords,
                fetchedAt: Date.now(),
            });
            if (silent) {
                lastSilentRefreshAtRef.current = Date.now();
            }

            setKeywords(nextKeywords);
            setSelectedKeyword((current) =>
                current && nextKeywords.some((item) => item.keyword === current)
                    ? current
                    : nextKeywords[0]?.keyword ?? ''
            );

            if (nextKeywords.length === 0) {
                setPosts([]);
                setNextCursor(null);
            }
        } catch (error) {
            if (reqSeq !== keywordsReqSeqRef.current) {
                return;
            }
            console.error('Trends load failed', error);
            if (!silent) {
                setKeywords([]);
                setSelectedKeyword('');
                setPosts([]);
                setNextCursor(null);
            }
        } finally {
            if (!silent) {
                setIsLoadingKeywords(false);
            }
        }
    }, [setTrendsKeywords]);

    const fetchKeywordFeed = useCallback(async (keyword: string, cursor?: string) => {
        const query = new URLSearchParams();
        query.set('limit', '30');
        if (cursor) query.set('cursor', cursor);

        const response = await api.get(`/trending/keywords/${encodeURIComponent(keyword)}/posts?${query.toString()}`);
        const hydrated = await hydrateParentPreviews(response.data.data ?? []);

        return {
            data: hydrated,
            nextCursor: response.data.nextCursor ?? null,
        };
    }, [hydrateParentPreviews]);

    const loadInitialFeed = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        const keywordForRequest = selectedKeyword;
        if (!keywordForRequest) {
            setPosts([]);
            setNextCursor(null);
            return;
        }

        const cachedFeed = useFeedCacheStore.getState().trendFeeds[keywordForRequest];
        if (isCacheFresh(cachedFeed, FEED_CACHE_TTL)) {
            setPosts(cachedFeed.data.map(applyInteractionSnapshot));
            setNextCursor(cachedFeed.nextCursor);
            setIsLoadingFeed(false);
            return;
        }

        if (silent && Date.now() - lastSilentRefreshAtRef.current < SILENT_REFRESH_MIN_INTERVAL) {
            return;
        }

        if (!silent) {
            setIsLoadingFeed(true);
        }

        const reqSeq = ++feedReqSeqRef.current;
        try {
            const result = await fetchKeywordFeed(keywordForRequest);
            if (reqSeq !== feedReqSeqRef.current || keywordForRequest !== selectedKeywordRef.current) {
                return;
            }

            syncFeedCache(keywordForRequest, result.data, result.nextCursor);
            setPosts(result.data);
            setNextCursor(result.nextCursor);
            if (silent) {
                lastSilentRefreshAtRef.current = Date.now();
            }
        } catch (error) {
            if (reqSeq !== feedReqSeqRef.current || keywordForRequest !== selectedKeywordRef.current) {
                return;
            }
            console.error('Keyword feed fetch failed', error);
            if (!silent) {
                setPosts([]);
                setNextCursor(null);
            }
        } finally {
            if (!silent) {
                setIsLoadingFeed(false);
            }
        }
    }, [fetchKeywordFeed, selectedKeyword, syncFeedCache]);

    const fetchMore = useCallback(async () => {
        if (!selectedKeyword || !nextCursor || isLoadingMore) {
            return;
        }

        const keywordForRequest = selectedKeyword;
        setIsLoadingMore(true);
        const reqSeq = ++feedReqSeqRef.current;
        try {
            const result = await fetchKeywordFeed(keywordForRequest, nextCursor);
            if (reqSeq !== feedReqSeqRef.current || keywordForRequest !== selectedKeywordRef.current) {
                return;
            }

            setPosts((current) => {
                const existingIds = new Set(current.map((item) => item.id));
                const uniqueNew = result.data.filter((item) => !existingIds.has(item.id));
                const merged = [...current, ...uniqueNew];
                syncFeedCache(keywordForRequest, merged, result.nextCursor);
                return merged;
            });
            setNextCursor(result.nextCursor);
        } catch (error) {
            console.error('Keyword feed load more failed', error);
        } finally {
            setIsLoadingMore(false);
        }
    }, [fetchKeywordFeed, isLoadingMore, nextCursor, selectedKeyword, syncFeedCache]);

    useEffect(() => {
        void fetchKeywords();
    }, [fetchKeywords]);

    useEffect(() => {
        void loadInitialFeed();
    }, [loadInitialFeed]);


    const navState = (location.state ?? {}) as { scrollY?: number };

    useScrollRestoration({
        storageKey: `trends-scroll:${selectedKeyword}`,
        ready: !isLoadingKeywords && !isLoadingFeed,
        contentKey: `${selectedKeyword}:${posts.length}:${nextCursor ?? 'end'}`,
        initialScrollY: navState.scrollY ?? null,
    });

    useVisibilityRefresh(() => {
        if (Date.now() - lastMutationAtRef.current < 4000) {
            return;
        }

        void fetchKeywords({ silent: true });
        void loadInitialFeed({ silent: true });
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

    const selectedKeywordCount = useMemo(
        () => keywords.find((item) => item.keyword === selectedKeyword)?.count ?? null,
        [keywords, selectedKeyword]
    );

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

            const existingCache = useFeedCacheStore.getState().trendFeeds[selectedKeywordRef.current];
            if (existingCache) {
                syncFeedCache(selectedKeywordRef.current, updated, existingCache.nextCursor);
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
    }, [syncFeedCache]);

    const handleShare = useCallback(async (postId: string) => {
        const shareUrl = `${window.location.origin}/post/${postId}`;

        try {
            if (ENABLE_SHARE_CARD) {
                const { sharePostCard } = await import('../lib/shareCard');
                await sharePostCard(postId, {
                    title: formatTrendingKeyword(selectedKeywordRef.current),
                    text: 'Club Threads postu',
                });
                return;
            }

            if (navigator.share) {
                await navigator.share({
                    title: formatTrendingKeyword(selectedKeywordRef.current),
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
        const existingCache = useFeedCacheStore.getState().trendFeeds[selectedKeywordRef.current];
        if (existingCache) {
            syncFeedCache(selectedKeywordRef.current, updatedPosts, existingCache.nextCursor);
        }

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

            <header className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))] z-20 border-b border-border bg-bg-primary/95 px-4 py-3 backdrop-blur md:top-0">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                    <TrendingUp size={14} />
                    Trendler
                </div>
                <h1 className="mt-1 text-xl font-extrabold text-text-primary">Su an konusulanlar</h1>
            </header>

            <section className="border-b border-border px-4 py-3">
                {isLoadingKeywords ? (
                    <div className="flex items-center justify-center py-4 text-text-secondary">
                        <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                ) : keywords.length === 0 ? (
                    <p className="py-3 text-sm text-text-secondary">Su anda trend olusan kelime yok.</p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {keywords.map((item) => {
                            const isActive = item.keyword === selectedKeyword;
                            return (
                                <button
                                    key={item.keyword}
                                    type="button"
                                    onClick={() => setSelectedKeyword(item.keyword)}
                                    className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${isActive
                                        ? 'border-border bg-text-primary text-inverse-primary'
                                        : 'border-border-subtle bg-bg-secondary text-text-primary hover:bg-bg-secondary'
                                        }`}
                                >
                                    {formatTrendingKeyword(item.keyword)}
                                    <span className={`ml-1.5 text-xs ${isActive ? 'text-inverse-primary/80' : 'text-text-muted'}`}>
                                        {item.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>

            {selectedKeyword && (
                <div className="border-b border-border px-4 py-3 text-sm text-text-secondary">
                    <span className="font-semibold text-text-primary">{formatTrendingKeyword(selectedKeyword)}</span>
                    {selectedKeywordCount !== null && (
                        <span className="ml-2">{selectedKeywordCount} gecis</span>
                    )}
                </div>
            )}

            <div>
                {isLoadingFeed ? (
                    <div className="flex min-h-[35vh] items-center justify-center text-text-secondary">
                        <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                ) : !selectedKeyword ? (
                    <div className="px-6 py-12 text-center text-sm text-text-secondary">Trend secerek post akisini gorebilirsin.</div>
                ) : posts.length === 0 ? (
                    <div className="px-6 py-12 text-center text-sm text-text-secondary">Bu kelime icin post bulunamadi.</div>
                ) : (
                    <>
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
                    </>
                )}
            </div>
        </div>
    );
}
