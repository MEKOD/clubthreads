import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/axios';
import { inferAnalyticsSurface, trackSearchEvent } from '../lib/analytics';
import { createTimelineNavigationState, withViewTransition } from '../lib/navigation';
import { PostCard } from '../components/feed/PostCard';
import { RepostComposerSheet } from '../components/feed/RepostComposerSheet';
import { useHomeFeedController } from '../hooks/useHomeFeedController';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface SearchUser {
    id: string;
    username: string;
    bio: string | null;
}

interface SearchPost {
    id: string;
    content: string | null;
    authorUsername: string;
}

export function Discover() {
    const location = useLocation();
    const navigate = useNavigate();
    const analyticsSurface = inferAnalyticsSurface(location.pathname);
    const [query, setQuery] = useState('');
    const [searchUsers, setSearchUsers] = useState<SearchUser[]>([]);
    const [searchPosts, setSearchPosts] = useState<SearchPost[]>([]);
    const shouldAutoFocusSearch = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
    const {
        displayPosts,
        displayLoading,
        isLoadingMore,
        activeNextCursor,
        repostTarget,
        quoteText,
        setQuoteText,
        quoteGif,
        setQuoteGif,
        isQuoteGifPickerOpen,
        setIsQuoteGifPickerOpen,
        isSubmittingRepost,
        loadMoreSentinelRef,
        handleInteract,
        handleShare,
        handleRepost,
        openCompose,
        closeRepostDialog,
        submitRepost,
        refreshActiveFeed,
    } = useHomeFeedController({
        allowedTabs: ['latest'],
        defaultTab: 'latest',
        persistedTabKey: 'search-active-tab',
        scrollStorageKeyPrefix: 'search-tab:',
    });

    useBodyScrollLock(Boolean(repostTarget));

    const isSearching = useMemo(() => query.trim().length >= 2, [query]);
    const buildDetailState = () => createTimelineNavigationState(location, { scrollY: window.scrollY });

    const runSearch = useCallback(async (rawQuery: string) => {
        const trimmedQuery = rawQuery.trim();
        if (trimmedQuery.length < 2) {
            setSearchUsers([]);
            setSearchPosts([]);
            return;
        }

        try {
            trackSearchEvent({ query: trimmedQuery, surface: analyticsSurface });
            const [usersResponse, postsResponse] = await Promise.all([
                api.get(`/search/users?q=${encodeURIComponent(trimmedQuery)}`),
                api.get(`/search/posts?q=${encodeURIComponent(trimmedQuery)}`),
            ]);
            setSearchUsers(usersResponse.data.users ?? []);
            setSearchPosts(postsResponse.data.posts ?? []);
        } catch (error) {
            console.error('Search failed', error);
        }
    }, [analyticsSurface]);

    useEffect(() => {
        if (!isSearching) {
            setSearchUsers([]);
            setSearchPosts([]);
            return;
        }

        const timeoutId = window.setTimeout(() => {
            void runSearch(query);
        }, 250);

        return () => window.clearTimeout(timeoutId);
    }, [isSearching, query, runSearch]);

    useEffect(() => {
        const refresh = (event?: Event) => {
            const path = (event as CustomEvent<{ path?: string }> | undefined)?.detail?.path;
            if (path && path !== location.pathname) {
                return;
            }

            if (query.trim().length >= 2) {
                void runSearch(query);
                return;
            }

            void refreshActiveFeed();
        };

        window.addEventListener('refresh-route', refresh);
        return () => window.removeEventListener('refresh-route', refresh);
    }, [location.pathname, query, refreshActiveFeed, runSearch]);

    return (
        <div className="mx-auto min-h-screen max-w-[600px] border-x border-border bg-bg-primary">
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

            <div className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))] z-20 border-b border-border bg-bg-primary/95 px-4 py-3 backdrop-blur md:top-0">
                <label className="flex items-center gap-3 rounded-[18px] bg-bg-tertiary px-4 py-3.5">
                    <Search size={18} className="text-text-secondary" />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        autoFocus={shouldAutoFocusSearch}
                        placeholder="Kullanici veya post ara..."
                        className="w-full bg-transparent text-[15px] text-text-primary outline-none placeholder:text-text-muted"
                    />
                </label>
                {!isSearching && (
                    <div className="pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                        En Son
                    </div>
                )}
            </div>

            {isSearching ? (
                <div className="divide-y divide-border">
                    {searchUsers.length > 0 && (
                        <section className="px-4 py-3">
                            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">Kullanicilar</div>
                            <div className="space-y-1">
                                {searchUsers.map((user) => (
                                    <Link key={user.id} to={`/users/${user.username}`} className="flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-bg-secondary">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-secondary text-sm font-bold text-text-primary">
                                            {user.username[0]?.toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-text-primary">@{user.username}</div>
                                            {user.bio && <p className="line-clamp-1 text-xs text-text-secondary">{user.bio}</p>}
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </section>
                    )}

                    {searchPosts.length > 0 && (
                        <section className="px-4 py-3">
                            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">Postlar</div>
                            <div className="space-y-1">
                                {searchPosts.slice(0, 10).map((post) => (
                                    <Link
                                        key={post.id}
                                        to={`/post/${post.id}`}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            navigate(`/post/${post.id}`, withViewTransition({ state: buildDetailState() }));
                                        }}
                                        className="block rounded-2xl px-3 py-3 transition hover:bg-bg-secondary"
                                    >
                                        <div className="text-xs font-medium text-text-muted">@{post.authorUsername}</div>
                                        <p className="mt-1 line-clamp-3 text-sm text-text-primary">{post.content || 'Medya postu'}</p>
                                    </Link>
                                ))}
                            </div>
                        </section>
                    )}

                    {searchUsers.length === 0 && searchPosts.length === 0 && (
                        <div className="px-6 py-14 text-center text-sm text-text-secondary">
                            Sonuc bulunamadi.
                        </div>
                    )}
                </div>
            ) : displayLoading && displayPosts.length === 0 ? (
                <div className="flex justify-center py-8 text-[15px] text-text-secondary">
                    En son postlar yukleniyor...
                </div>
            ) : displayPosts.length === 0 ? (
                <div className="px-8 py-12 text-center">
                    <div className="text-[20px] font-extrabold text-text-primary">En son akis su an bos.</div>
                    <p className="mt-2 text-[15px] text-text-secondary">Ilk postu at veya biraz sonra tekrar bak.</p>
                </div>
            ) : (
                <>
                    {displayPosts.map((post) => (
                        <PostCard
                            key={post.id}
                            post={post}
                            feedMode="latest"
                            onInteract={handleInteract}
                            onRepost={handleRepost}
                            onShare={handleShare}
                            onReply={() => void refreshActiveFeed()}
                        />
                    ))}

                    {activeNextCursor && (
                        <div ref={loadMoreSentinelRef} className="flex justify-center py-6">
                            {isLoadingMore && <Loader2 className="h-6 w-6 animate-spin text-text-muted" />}
                        </div>
                    )}
                </>
            )}

            <button
                type="button"
                onClick={openCompose}
                aria-label="Post olustur"
                className="fixed bottom-[calc(var(--mobile-tabbar-offset)+env(safe-area-inset-bottom)+1rem)] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-text-primary text-inverse-primary shadow-lg transition-transform active:scale-95 md:hidden"
            >
                <span className="pointer-events-none select-none text-[34px] leading-none">+</span>
            </button>
        </div>
    );
}
