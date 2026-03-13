import { useEffect, useMemo, useState } from 'react';
import { Flame, Search, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/axios';
import { inferAnalyticsSurface, trackSearchEvent } from '../../lib/analytics';
import { formatTrendingKeyword, type CommunitySummary, type TimelinePost, type TrendingKeyword } from '../../lib/social';
import { isCacheFresh, useFeedCacheStore } from '../../store/feedCacheStore';

interface SearchUser {
    id: string;
    username: string;
    bio: string | null;
}

const RAIL_CACHE_TTL = 30_000;

export function RightRail() {
    const location = useLocation();
    const analyticsSurface = inferAnalyticsSurface(location.pathname);
    const [query, setQuery] = useState('');
    const [communities, setCommunities] = useState<CommunitySummary[]>([]);
    const [users, setUsers] = useState<SearchUser[]>([]);
    const [posts, setPosts] = useState<TimelinePost[]>([]);
    const [topPosts, setTopPosts] = useState<TimelinePost[]>([]);
    const [keywords, setKeywords] = useState<TrendingKeyword[]>([]);

    useEffect(() => {
        const loadRail = async () => {
            const railCache = useFeedCacheStore.getState().rail;
            if (railCache && isCacheFresh(railCache, RAIL_CACHE_TTL)) {
                setCommunities(railCache.communities);
                setTopPosts(railCache.topPosts);
                setKeywords(railCache.keywords);
                return;
            }

            try {
                const [communitiesResponse, topPostsResponse, keywordsResponse] = await Promise.all([
                    api.get('/communities?limit=6&scope=discover'),
                    api.get('/trending/posts?window=24h&limit=3'),
                    api.get('/trending/keywords?window=6h&limit=10'),
                ]);
                const nextCommunities = communitiesResponse.data.communities ?? [];
                const nextTopPosts = topPostsResponse.data.posts ?? topPostsResponse.data.data ?? [];
                const nextKeywords = keywordsResponse.data.keywords ?? [];
                useFeedCacheStore.getState().setRail({
                    communities: nextCommunities,
                    topPosts: nextTopPosts,
                    keywords: nextKeywords,
                    fetchedAt: Date.now(),
                });
                setCommunities(nextCommunities);
                setTopPosts(nextTopPosts);
                setKeywords(nextKeywords);
            } catch (error) {
                console.error('Rail data could not be loaded', error);
            }
        };

        void loadRail();
    }, []);

    useEffect(() => {
        if (query.trim().length < 2) {
            return;
        }

        const timeoutId = window.setTimeout(async () => {
            try {
                trackSearchEvent({ query, surface: analyticsSurface });
                const [usersResponse, postsResponse] = await Promise.all([
                    api.get(`/search/users?q=${encodeURIComponent(query)}`),
                    api.get(`/search/posts?q=${encodeURIComponent(query)}`),
                ]);

                setUsers(usersResponse.data.users ?? []);
                setPosts(postsResponse.data.posts ?? []);
            } catch (error) {
                console.error('Search failed', error);
            }
        }, 280);

        return () => window.clearTimeout(timeoutId);
    }, [analyticsSurface, query]);

    const isSearching = useMemo(() => query.trim().length >= 2, [query]);

    return (
        <aside className="sticky top-0 hidden h-screen w-[340px] shrink-0 flex-col gap-5 overflow-hidden px-5 py-6 xl:flex">
            <div className="rounded-[28px] border border-border-subtle bg-bg-primary/75 p-3 shadow-[0_18px_60px_rgba(17,17,17,0.06)] backdrop-blur">
                <label className="flex items-center gap-3 rounded-[20px] bg-bg-secondary px-4 py-3">
                    <Search size={18} className="text-text-secondary" />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Ara: user, post, topluluk"
                        className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                    />
                </label>
            </div>

            {isSearching ? (
                <div className="native-sheet-scroll min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 pb-6">
                    <section className="rounded-[28px] border border-border-subtle bg-bg-primary/92 p-5 shadow-[0_18px_60px_rgba(17,17,17,0.06)]">
                        <div className="mb-4 text-sm font-semibold text-text-primary">Kullanicilar</div>
                        <div className="space-y-3">
                            {users.length === 0 ? (
                                <p className="text-sm text-text-secondary">Eslesen kullanici yok.</p>
                            ) : (
                                users.map((user) => (
                                    <Link key={user.id} to={`/users/${user.username}`} className="block rounded-2xl border border-border-subtle px-4 py-3 transition hover:bg-bg-secondary">
                                        <div className="font-medium text-text-primary">@{user.username}</div>
                                        {user.bio && <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{user.bio}</p>}
                                    </Link>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="rounded-[28px] border border-border-subtle bg-bg-primary/92 p-5 shadow-[0_18px_60px_rgba(17,17,17,0.06)]">
                        <div className="mb-4 text-sm font-semibold text-text-primary">Postlar</div>
                        <div className="space-y-3">
                            {posts.length === 0 ? (
                                <p className="text-sm text-text-secondary">Eslesen post yok.</p>
                            ) : (
                                posts.slice(0, 5).map((post) => (
                                    <Link key={post.id} to={`/post/${post.id}`} className="block rounded-2xl border border-border-subtle px-4 py-3 transition hover:bg-bg-secondary">
                                        <div className="text-sm font-medium text-text-primary">@{post.authorUsername}</div>
                                        <p className="mt-1 line-clamp-3 text-sm text-text-secondary">{post.content || 'Medya postu'}</p>
                                    </Link>
                                ))
                            )}
                        </div>
                    </section>
                </div>
            ) : (
                <div className="native-sheet-scroll min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 pb-6">
                    <section className="rounded-[28px] border border-border-subtle bg-bg-primary/92 p-5 shadow-[0_18px_60px_rgba(17,17,17,0.06)]">
                        <div className="mb-4 text-sm font-semibold text-text-primary">Su an konusulanlar</div>
                        <div className="flex flex-wrap gap-2">
                            {keywords.length === 0 ? (
                                <p className="text-sm text-text-secondary">Gundem olusmadi.</p>
                            ) : (
                                keywords.map((item) => (
                                    <Link
                                        key={item.keyword}
                                        to={`/topic/${encodeURIComponent(item.keyword)}`}
                                        className="rounded-full bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary transition hover:bg-bg-hover"
                                    >
                                        {formatTrendingKeyword(item.keyword)}
                                        <span className="ml-2 text-xs text-text-muted">{item.count}</span>
                                    </Link>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="rounded-[28px] border border-border-subtle bg-bg-primary/92 p-5 shadow-[0_18px_60px_rgba(17,17,17,0.06)]">
                        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-primary">
                            <Flame size={16} />
                            Onde olanlar
                        </div>

                        <div className="space-y-3">
                            {topPosts.length === 0 ? (
                                <p className="text-sm text-text-secondary">Hareket yeni toplaniyor.</p>
                            ) : (
                                topPosts.map((post, index) => (
                                    <Link key={post.id} to={`/post/${post.id}`} className="block rounded-2xl border border-border-subtle px-4 py-3 transition hover:bg-bg-secondary">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">#{index + 1}</div>
                                            <div className="text-xs text-text-muted">{post.favCount} fav</div>
                                        </div>
                                        <p className="mt-2 line-clamp-2 text-sm text-text-secondary">{post.content || 'Medya postu'}</p>
                                    </Link>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="rounded-[28px] border border-border-subtle bg-bg-primary/92 p-5 shadow-[0_18px_60px_rgba(17,17,17,0.06)]">
                        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-primary">
                            <Users size={16} />
                            Universite topluluklari
                        </div>

                        <div className="space-y-3">
                            {communities.map((community) => (
                                <Link key={community.id} to={`/communities/${community.slug}`} className="block rounded-2xl border border-border-subtle px-4 py-3 transition hover:bg-bg-secondary">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="font-medium text-text-primary">/{community.slug}</div>
                                        <span className="rounded-full bg-bg-tertiary px-2 py-1 text-[11px] font-semibold text-text-muted">
                                            {community.memberCount} uye
                                        </span>
                                    </div>
                                    {community.description && (
                                        <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{community.description}</p>
                                    )}
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
            )}
        </aside>
    );
}
