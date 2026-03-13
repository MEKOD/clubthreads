import { Image as ImageIcon, Loader2, Lock, Mail, Plus, Search, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { inferAnalyticsSurface, trackSearchEvent } from '../lib/analytics';
import { api, toAbsoluteUrl } from '../lib/axios';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { withViewTransition } from '../lib/navigation';
import { warmRouteModule } from '../lib/routeModules';
import type { CommunityInvite, CommunitySummary } from '../lib/social';
import { useCommunityStore } from '../store/communityStore';

function CommunityListSection({
    title,
    icon,
    communities,
    emptyLabel,
    joinLoadingSlug,
    onOpen,
    onJoinToggle,
}: {
    title: string;
    icon: ReactNode;
    communities: CommunitySummary[];
    emptyLabel?: string;
    joinLoadingSlug: string | null;
    onOpen: (community: CommunitySummary) => void;
    onJoinToggle: (community: CommunitySummary) => Promise<void>;
}) {
    return (
        <section className="space-y-3">
            <div className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                {icon}
                {title}
            </div>
            {communities.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-black/[0.08] bg-bg-primary/70 px-5 py-8 text-sm text-text-secondary">
                    {emptyLabel ?? 'Bu bolumde henuz gosterilecek bir community yok.'}
                </div>
            ) : communities.map((community) => (
                <div
                    key={community.id}
                    className="rounded-[24px] border border-black/[0.06] bg-bg-primary/95 p-4 shadow-[0_8px_32px_rgba(17,17,17,0.04)]"
                >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <button
                            type="button"
                            onClick={() => {
                                if (community.isPrivate && !community.isMember) return;
                                onOpen(community);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-bg-secondary text-lg font-black text-text-primary">
                                {community.avatarUrl ? (
                                    <img src={toAbsoluteUrl(community.avatarUrl) ?? undefined} alt={community.name} className="h-full w-full object-cover" />
                                ) : (
                                    community.slug[0]?.toUpperCase()
                                )}
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="truncate text-[15px] font-semibold text-text-primary">/{community.slug}</div>
                                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${community.isPrivate ? 'bg-text-primary text-inverse-primary' : 'border border-border-subtle text-text-secondary'}`}>
                                        {community.isPrivate ? <Lock size={10} /> : <Users size={10} />}
                                        {community.isPrivate ? 'Private' : 'Public'}
                                    </span>
                                    {community.isMember && (
                                        <span className="inline-flex items-center rounded-full bg-bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                                            Uye
                                        </span>
                                    )}
                                </div>
                                <div className="mt-1 text-xs text-text-muted">
                                    {community.memberCount} uye
                                    {community.description && ` · ${community.description}`}
                                </div>
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => void onJoinToggle(community)}
                            disabled={joinLoadingSlug === community.slug || Boolean(community.hasRequestedJoin)}
                            className={`flex w-full shrink-0 items-center justify-center rounded-full px-3.5 py-2.5 text-xs font-semibold transition sm:w-auto ${community.isMember
                                ? 'border border-black/[0.08] text-text-secondary hover:bg-bg-secondary'
                                : community.hasRequestedJoin
                                    ? 'border border-black/[0.08] text-text-secondary'
                                    : 'bg-text-primary text-inverse-primary'
                                }`}
                        >
                            {joinLoadingSlug === community.slug ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : community.isMember ? (
                                <span className="flex items-center gap-1.5"><UserMinus size={13} /> Uyesin</span>
                            ) : community.hasRequestedJoin ? (
                                'Istek gonderildi'
                            ) : (
                                <span className="flex items-center gap-1.5"><UserPlus size={13} /> Katil</span>
                            )}
                        </button>
                    </div>
                </div>
            ))}
        </section>
    );
}

export function CommunityHubPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const analyticsSurface = inferAnalyticsSurface(location.pathname);
    const setLastVisitedCommunitySlug = useCommunityStore((state) => state.setLastVisitedCommunitySlug);
    const membershipVersion = useCommunityStore((state) => state.membershipVersion);
    const [search, setSearch] = useState('');
    const [joinedCommunities, setJoinedCommunities] = useState<CommunitySummary[]>([]);
    const [discoverCommunities, setDiscoverCommunities] = useState<CommunitySummary[]>([]);
    const [searchResults, setSearchResults] = useState<CommunitySummary[]>([]);
    const [invites, setInvites] = useState<CommunityInvite[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [joinLoadingSlug, setJoinLoadingSlug] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [createAvatarPreviewUrl, setCreateAvatarPreviewUrl] = useState<string | null>(null);
    const [createAvatarFile, setCreateAvatarFile] = useState<File | null>(null);
    const createAvatarInputRef = useRef<HTMLInputElement | null>(null);
    const [createForm, setCreateForm] = useState({ name: '', slug: '', description: '', isPrivate: false });
    const [refreshNonce, setRefreshNonce] = useState(0);
    const navState = (location.state ?? {}) as { scrollY?: number };

    useScrollRestoration({
        storageKey: `community-hub-scroll:${search.trim() ? 'search' : 'default'}`,
        ready: !loadingList,
        contentKey: `${search.trim()}:${joinedCommunities.length}:${discoverCommunities.length}:${searchResults.length}:${invites.length}:${showCreate ? 'create' : 'list'}`,
        initialScrollY: navState.scrollY ?? null,
    });

    useEffect(() => {
        let cancelled = false;

        const loadCommunities = async () => {
            setLoadingList(true);
            try {
                const query = search.trim();
                if (query) {
                    trackSearchEvent({ query, surface: analyticsSurface });
                }
                const requests = query
                    ? [
                        api.get('/communities', {
                            params: {
                                limit: 30,
                                q: query,
                            },
                        }),
                    ]
                    : [
                        api.get('/communities', {
                            params: {
                                limit: 18,
                                scope: 'joined',
                            },
                        }),
                        api.get('/communities', {
                            params: {
                                limit: 18,
                                scope: 'discover',
                            },
                        }),
                    ];
                const [communityResponses, invitesResponse] = await Promise.all([
                    Promise.all(requests),
                    api.get('/communities/me/invites').catch(() => ({ data: { invites: [] } })),
                ]);

                if (cancelled) return;
                if (query) {
                    setSearchResults(communityResponses[0]?.data.communities ?? []);
                    setJoinedCommunities([]);
                    setDiscoverCommunities([]);
                } else {
                    setJoinedCommunities(communityResponses[0]?.data.communities ?? []);
                    setDiscoverCommunities((communityResponses[1]?.data.communities ?? []).filter((community: CommunitySummary) => !community.isMember));
                    setSearchResults([]);
                }
                setInvites(invitesResponse.data.invites ?? []);
            } catch (error) {
                if (!cancelled) {
                    console.error('Community list load failed', error);
                }
            } finally {
                if (!cancelled) {
                    setLoadingList(false);
                }
            }
        };

        const timer = window.setTimeout(() => {
            void loadCommunities();
        }, search.trim() ? 250 : 0);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [analyticsSurface, refreshNonce, search, membershipVersion]);

    useEffect(() => {
        const refresh = (event?: Event) => {
            const path = (event as CustomEvent<{ path?: string }> | undefined)?.detail?.path;
            if (path && path !== location.pathname) {
                return;
            }
            setRefreshNonce((current) => current + 1);
        };

        window.addEventListener('refresh-route', refresh);
        return () => window.removeEventListener('refresh-route', refresh);
    }, [location.pathname]);

    const openCommunity = (community: Pick<CommunitySummary, 'slug'>) => {
        setLastVisitedCommunitySlug(community.slug);
        warmRouteModule('communityDetail');
        navigate(`/communities/${community.slug}`, withViewTransition({
            state: { scrollY: window.scrollY },
        }));
    };

    const handleJoinToggle = async (community: CommunitySummary | (CommunityInvite & { isMember: boolean; viewerRole: null })) => {
        setJoinLoadingSlug(community.slug);
        try {
            if (community.isMember) {
                await api.delete(`/communities/${community.slug}/join`);
            } else {
                const response = await api.post(`/communities/${community.slug}/join`);
                if (response.data.requested) {
                    const markRequested = (items: CommunitySummary[]) => items.map((item) => item.slug === community.slug ? {
                        ...item,
                        hasRequestedJoin: true,
                        hasInvite: false,
                    } : item);
                    setJoinedCommunities(markRequested);
                    setDiscoverCommunities(markRequested);
                    setSearchResults(markRequested);
                    setInvites((current) => current.filter((invite) => invite.slug !== community.slug));
                    return;
                }
                if (response.data.isMember) {
                    setLastVisitedCommunitySlug(community.slug);
                }
            }

            const updateMembership = (items: CommunitySummary[]) => items
                .map((item) => item.slug === community.slug ? {
                    ...item,
                    isMember: !community.isMember,
                    viewerRole: community.isMember ? null : 'member' as const,
                    memberCount: community.isMember ? Math.max(0, item.memberCount - 1) : item.memberCount + 1,
                    hasInvite: false,
                    hasRequestedJoin: false,
                } : item);

            const joinedCommunity: CommunitySummary = 'id' in community ? {
                ...community,
                isMember: true,
                viewerRole: 'member',
                memberCount: community.memberCount + 1,
                hasInvite: false,
                hasRequestedJoin: false,
            } : {
                id: community.communityId,
                name: community.name,
                slug: community.slug,
                description: community.description,
                isPrivate: community.isPrivate,
                memberCount: community.memberCount + 1,
                avatarUrl: community.avatarUrl,
                bannerUrl: community.bannerUrl,
                creatorId: community.creatorId,
                createdAt: community.createdAt,
                isMember: true,
                viewerRole: 'member',
                hasInvite: false,
                hasRequestedJoin: false,
            };

            setJoinedCommunities((current) => {
                const exists = current.some((item) => item.slug === community.slug);
                const updated = updateMembership(current);
                if (community.isMember) {
                    return updated.filter((item) => item.isMember);
                }
                if (!exists) {
                    return [joinedCommunity, ...updated];
                }
                return updated.filter((item) => item.isMember);
            });
            setDiscoverCommunities((current) => updateMembership(current).filter((item) => !item.isMember));
            setSearchResults(updateMembership);
            setInvites((current) => current.filter((invite) => invite.slug !== community.slug));
        } catch (error) {
            console.error('Join/leave failed', error);
        } finally {
            setJoinLoadingSlug(null);
        }
    };

    const handleCreate = async (event: FormEvent) => {
        event.preventDefault();
        if (!createForm.name.trim() || !createForm.slug.trim()) return;

        setCreateLoading(true);
        try {
            let avatarUrl: string | undefined;
            if (createAvatarFile) {
                const formData = new FormData();
                formData.append('file', createAvatarFile);
                const uploadResponse = await api.post('/media/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                avatarUrl = uploadResponse.data.url ?? undefined;
            }

            const response = await api.post('/communities', {
                name: createForm.name.trim(),
                slug: createForm.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''),
                description: createForm.description.trim() || undefined,
                avatarUrl,
                isPrivate: createForm.isPrivate,
            });

            setCreateForm({ name: '', slug: '', description: '', isPrivate: false });
            setCreateAvatarFile(null);
            setCreateAvatarPreviewUrl(null);
            setShowCreate(false);
            setLastVisitedCommunitySlug(response.data.community.slug);
            warmRouteModule('communityDetail');
            navigate(`/communities/${response.data.community.slug}`, withViewTransition({
                state: { scrollY: window.scrollY },
            }));
        } catch (error) {
            console.error('Create failed', error);
        } finally {
            setCreateLoading(false);
        }
    };

    const handleCreateAvatarSelect = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0] ?? null;
        if (!file) return;
        setCreateAvatarFile(file);
        setCreateAvatarPreviewUrl(URL.createObjectURL(file));
    };

    const clearCreateAvatar = () => {
        setCreateAvatarFile(null);
        setCreateAvatarPreviewUrl(null);
        if (createAvatarInputRef.current) {
            createAvatarInputRef.current.value = '';
        }
    };

    return (
        <div className="mx-auto min-h-screen max-w-[760px] px-3 py-4 md:px-0 md:py-3">
            <div className="rounded-[24px] border border-black/[0.06] bg-bg-primary/95 p-4 shadow-[0_18px_60px_rgba(17,17,17,0.06)] md:rounded-[28px] md:p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-muted">kampus</div>
                <h1 className="text-[28px] font-black tracking-tight text-text-primary">Topluluklar</h1>
                <p className="mt-1 text-sm text-text-secondary">Topluluk ara, davetleri yonet, yenisini kur.</p>

                <div className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))] mt-4 md:static">
                    <label className="flex items-center gap-3 rounded-[22px] border border-black/[0.08] bg-bg-secondary/80 px-4 py-3 text-sm text-text-secondary shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
                        <Search size={16} />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Community ara"
                            className="w-full bg-transparent text-text-primary outline-none placeholder:text-text-muted"
                        />
                    </label>
                </div>
            </div>

            <div className="mt-4">
                {!showCreate ? (
                    <button
                        type="button"
                        onClick={() => setShowCreate(true)}
                        className="flex w-full items-center gap-3 rounded-[22px] border border-dashed border-black/[0.12] bg-bg-primary/70 px-5 py-4 text-sm font-medium text-text-secondary transition hover:border-black/20 hover:bg-bg-primary/90"
                    >
                        <Plus size={18} />
                        Yeni topluluk kur
                    </button>
                ) : (
                    <form
                        onSubmit={handleCreate}
                        className="rounded-[26px] border border-black/[0.06] bg-bg-primary/95 p-5 shadow-[0_18px_60px_rgba(17,17,17,0.06)]"
                    >
                        <div className="mb-4 text-sm font-semibold text-text-primary">Yeni topluluk</div>
                        <div className="space-y-3">
                            <input
                                value={createForm.name}
                                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="Topluluk adi"
                                className="w-full rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm outline-none placeholder:text-text-muted focus:border-black/20"
                            />
                            <input
                                value={createForm.slug}
                                onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value }))}
                                placeholder="slug"
                                className="w-full rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm outline-none placeholder:text-text-muted focus:border-black/20"
                            />
                            <textarea
                                value={createForm.description}
                                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                                placeholder="Aciklama"
                                rows={2}
                                className="w-full resize-none rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm outline-none placeholder:text-text-muted focus:border-black/20"
                            />
                            <div className="rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-4">
                                <div className="mb-3 text-sm font-semibold text-text-primary">Community fotografi</div>
                                <div className="flex items-center gap-4">
                                    <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-bg-primary text-base font-black text-text-primary">
                                        {createAvatarPreviewUrl ? (
                                            <img src={createAvatarPreviewUrl} alt="Community avatar preview" className="h-full w-full object-cover" />
                                        ) : (
                                            createForm.name[0]?.toUpperCase() || '?'
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <input
                                            ref={createAvatarInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleCreateAvatarSelect}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => createAvatarInputRef.current?.click()}
                                            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-bg-primary px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-white/5"
                                        >
                                            <ImageIcon size={16} />
                                            Fotograf sec
                                        </button>
                                        {createAvatarPreviewUrl && (
                                            <button
                                                type="button"
                                                onClick={clearCreateAvatar}
                                                className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-text-secondary transition hover:bg-bg-primary"
                                            >
                                                <X size={14} />
                                                Kaldir
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <label className="flex items-center justify-between rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm text-text-primary">
                                <div>
                                    <div className="font-semibold">Private community</div>
                                    <div className="mt-1 text-xs text-text-secondary">Sadece uyeler icerigi ve member listesini gorur.</div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={createForm.isPrivate}
                                    onChange={(e) => setCreateForm((f) => ({ ...f, isPrivate: e.target.checked }))}
                                    className="h-4 w-4 accent-text-primary"
                                />
                            </label>
                        </div>
                        <div className="mt-4 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowCreate(false)}
                                className="rounded-full px-4 py-2.5 text-sm font-medium text-text-secondary transition hover:bg-bg-secondary"
                            >
                                Vazgec
                            </button>
                            <button
                                type="submit"
                                disabled={!createForm.name.trim() || !createForm.slug.trim() || createLoading}
                                className="rounded-full bg-text-primary px-5 py-2.5 text-sm font-semibold text-inverse-primary disabled:opacity-50"
                            >
                                {createLoading ? <Loader2 size={16} className="animate-spin" /> : 'Olustur'}
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <div className="mt-4 space-y-4">
                {invites.length > 0 && (
                    <div className="rounded-[24px] border border-black/[0.06] bg-bg-primary/95 p-4 shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                            <Mail size={16} />
                            Gelen davetler
                        </div>
                        <div className="space-y-3">
                            {invites.map((invite) => (
                                <div key={`${invite.communityId}-${invite.slug}`} className="flex items-center gap-3 rounded-2xl bg-bg-secondary/70 p-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-bg-primary text-lg font-black text-text-primary">
                                        {invite.slug[0]?.toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-semibold text-text-primary">/{invite.slug}</div>
                                        <div className="mt-1 line-clamp-1 text-xs text-text-secondary">
                                            @{invite.inviterUsername} seni davet etti
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleJoinToggle({ ...invite, isMember: false, viewerRole: null })}
                                        disabled={joinLoadingSlug === invite.slug}
                                        className="rounded-full bg-text-primary px-3.5 py-2 text-xs font-semibold text-inverse-primary"
                                    >
                                        {joinLoadingSlug === invite.slug ? <Loader2 size={14} className="animate-spin" /> : 'Kabul et'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {loadingList ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                    </div>
                ) : (
                    <div className="space-y-3">
                        {search.trim() ? (
                            searchResults.filter((community) => !community.hasInvite).length === 0 ? (
                                <div className="rounded-[24px] border border-black/[0.06] bg-bg-primary/90 px-5 py-12 text-center text-sm text-text-secondary shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                                    Aramana uyan community bulunamadi.
                                </div>
                            ) : (
                                <CommunityListSection
                                    title="Arama Sonuclari"
                                    icon={<Search size={13} />}
                                    communities={searchResults.filter((community) => !community.hasInvite)}
                                    joinLoadingSlug={joinLoadingSlug}
                                    onOpen={openCommunity}
                                    onJoinToggle={handleJoinToggle}
                                />
                            )
                        ) : (
                            <>
                                <CommunityListSection
                                    title="Katildigin Communityler"
                                    icon={<Users size={13} />}
                                    communities={joinedCommunities.filter((community) => !community.hasInvite)}
                                    emptyLabel="Henuz katildigin bir community yok."
                                    joinLoadingSlug={joinLoadingSlug}
                                    onOpen={openCommunity}
                                    onJoinToggle={handleJoinToggle}
                                />
                                <CommunityListSection
                                    title="Kesfet"
                                    icon={<Search size={13} />}
                                    communities={discoverCommunities.filter((community) => !community.hasInvite)}
                                    emptyLabel="Su an kesfet listesinde yeni public community yok."
                                    joinLoadingSlug={joinLoadingSlug}
                                    onOpen={openCommunity}
                                    onJoinToggle={handleJoinToggle}
                                />
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
