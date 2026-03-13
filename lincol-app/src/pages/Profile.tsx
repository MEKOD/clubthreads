import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Loader2, MessageCircle, Share2, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { api, getAvatarUrl, toAbsoluteUrl } from '../lib/axios';
import { useAuthStore } from '../store/authStore';
import { PostCard } from '../components/feed/PostCard';
import { RepostComposerSheet } from '../components/feed/RepostComposerSheet';
import type { ParentPreview, TimelinePost } from '../lib/social';
import { VerifiedBadge } from '../components/ui/VerifiedBadge';
import { trackAnalyticsEvent } from '../lib/analytics';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';
import { applyInteractionSnapshot, setInteractionSnapshot } from '../lib/interactionCache';
import { withViewTransition } from '../lib/navigation';
import { warmRouteModule } from '../lib/routeModules';

interface ProfileData {
    id: string;
    username: string;
    bio: string | null;
    profilePic: string | null;
    coverPic?: string | null;
    role: 'user' | 'pink' | 'elite' | 'admin';
    followerCount: number;
    followingCount: number;
    postCount: number;
    totalFavCount: number;
    totalTrashCount: number;
    isFollowing: boolean;
    followsYou?: boolean;
    canDm?: boolean;
    joinedAt: string;
}

interface ProfilePost {
    id: string;
    content: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    type?: 'post' | 'rt' | 'quote';
    parentId?: string | null;
    favCount?: number;
    trashCount?: number;
    replyCount?: number;
    rtCount?: number;
    viewCount?: number;
    createdAt: string;
    communityId?: string | null;
    communitySlug?: string | null;
    communityName?: string | null;
    hasFav?: boolean;
    hasTrash?: boolean;
}

interface FollowListUser {
    id: string;
    username: string;
    profilePic: string | null;
    bio: string | null;
}

interface ProfileCacheEntry {
    profile: ProfileData;
    posts: ProfilePost[];
    hasMore: boolean;
    fetchedAt: number;
}

interface AmbientPalette {
    primary: string;
    secondary: string;
    tertiary: string;
}

type ProfileTab = 'post' | 'rt' | 'quote';
type ProfileRole = ProfileData['role'];

const PROFILE_CACHE_TTL = 20_000;
const profileCache = new Map<string, ProfileCacheEntry>();

function hasStableProfileMetrics(profile: ProfileData) {
    return Number.isFinite(profile.totalFavCount) && Number.isFinite(profile.totalTrashCount);
}

const ROLE_VISUALS: Record<ProfileRole, {
    accent: string;
    soft: string;
    ring: string;
}> = {
    user: {
        accent: '#1d9bf0',
        soft: 'rgba(29, 155, 240, 0.12)',
        ring: 'rgba(29, 155, 240, 0.35)',
    },
    pink: {
        accent: '#f91880',
        soft: 'rgba(249, 24, 128, 0.14)',
        ring: 'rgba(249, 24, 128, 0.34)',
    },
    elite: {
        accent: '#2ea8ff',
        soft: 'rgba(46, 168, 255, 0.15)',
        ring: 'rgba(46, 168, 255, 0.38)',
    },
    admin: {
        accent: '#ff6a33',
        soft: 'rgba(255, 106, 51, 0.14)',
        ring: 'rgba(255, 106, 51, 0.38)',
    },
};

function buildPostsUrl(username: string, tab: ProfileTab, page: number) {
    return `/users/${username}/posts?type=${tab}&page=${page}`;
}

function roleLabel(role: ProfileRole) {
    if (role === 'admin') return 'Admin';
    if (role === 'elite') return 'Elite';
    if (role === 'pink') return 'Pink';
    return 'Member';
}

function formatCount(value: number) {
    return new Intl.NumberFormat('tr-TR').format(Math.max(0, value));
}

function profileCompletion(profile: ProfileData | null) {
    if (!profile) return 0;
    let score = 40;
    if (profile.bio?.trim()) score += 25;
    if (profile.profilePic) score += 20;
    if (profile.coverPic) score += 15;
    return Math.min(score, 100);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function hashString(input: string) {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
    }
    return hash;
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;

    if (max === min) {
        return [0, 0, lightness * 100];
    }

    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue = 0;

    if (max === r) {
        hue = (g - b) / delta + (g < b ? 6 : 0);
    } else if (max === g) {
        hue = (b - r) / delta + 2;
    } else {
        hue = (r - g) / delta + 4;
    }

    return [Math.round(hue * 60), Math.round(saturation * 100), Math.round(lightness * 100)];
}

function buildPaletteFromHue(hue: number, saturation = 70, lightness = 52): AmbientPalette {
    const normalizedHue = ((hue % 360) + 360) % 360;
    const sat = clamp(saturation, 34, 88);
    const light = clamp(lightness, 36, 70);

    return {
        primary: `hsla(${normalizedHue}, ${sat}%, ${clamp(light + 6, 40, 76)}%, 0.94)`,
        secondary: `hsla(${(normalizedHue + 28) % 360}, ${clamp(sat - 6, 30, 80)}%, ${clamp(light + 10, 42, 82)}%, 0.84)`,
        tertiary: `hsla(${(normalizedHue + 160) % 360}, ${clamp(sat - 20, 24, 72)}%, ${clamp(light - 4, 32, 58)}%, 0.72)`,
    };
}

function buildSeedPalette(seed: string, role: ProfileRole): AmbientPalette {
    const baseHue = hashString(`${seed}:${role}`) % 360;
    const roleShift = role === 'pink' ? 24 : role === 'elite' ? 196 : role === 'admin' ? 8 : 220;
    return buildPaletteFromHue((baseHue + roleShift) % 360);
}

async function extractPaletteFromImage(imageSrc: string, role: ProfileRole, fallback: AmbientPalette): Promise<AmbientPalette> {
    if (typeof window === 'undefined') {
        return fallback;
    }

    return await new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.referrerPolicy = 'no-referrer';
        image.decoding = 'async';

        image.onload = () => {
            try {
                const size = 24;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const context = canvas.getContext('2d', { willReadFrequently: true });

                if (!context) {
                    resolve(fallback);
                    return;
                }

                context.drawImage(image, 0, 0, size, size);
                const { data } = context.getImageData(0, 0, size, size);

                let red = 0;
                let green = 0;
                let blue = 0;
                let weight = 0;

                for (let index = 0; index < data.length; index += 16) {
                    const alpha = data[index + 3];
                    if (alpha < 110) {
                        continue;
                    }

                    const sampleRed = data[index];
                    const sampleGreen = data[index + 1];
                    const sampleBlue = data[index + 2];
                    const luminance = (sampleRed + sampleGreen + sampleBlue) / 3;
                    if (luminance < 18) {
                        continue;
                    }

                    const sampleWeight = clamp((luminance / 255) * 1.1, 0.3, 1.4);
                    red += sampleRed * sampleWeight;
                    green += sampleGreen * sampleWeight;
                    blue += sampleBlue * sampleWeight;
                    weight += sampleWeight;
                }

                if (weight === 0) {
                    resolve(fallback);
                    return;
                }

                const [hue, saturation, lightness] = rgbToHsl(red / weight, green / weight, blue / weight);
                const roleShift = role === 'pink' ? 10 : role === 'elite' ? 2 : role === 'admin' ? -8 : 0;
                resolve(
                    buildPaletteFromHue(
                        hue + roleShift,
                        Math.max(saturation, role === 'user' ? 46 : 60),
                        clamp(lightness, 40, 60)
                    )
                );
            } catch {
                resolve(fallback);
            }
        };

        image.onerror = () => resolve(fallback);
        image.src = imageSrc;
    });
}

export function Profile() {
    const { username } = useParams<{ username: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const currentUser = useAuthStore((state) => state.user);
    const resolvedUsername = username || currentUser?.username;
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [posts, setPosts] = useState<ProfilePost[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(1);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isFollowUpdating, setIsFollowUpdating] = useState(false);
    const [followOverride, setFollowOverride] = useState<boolean | null>(null);
    const [followerCountOverride, setFollowerCountOverride] = useState<number | null>(null);
    const [ambientPalette, setAmbientPalette] = useState<AmbientPalette>(() => buildSeedPalette(resolvedUsername ?? 'club-threads', 'user'));
    const tabParam = searchParams.get('tab');
    const activeTab: ProfileTab = tabParam === 'rt' || tabParam === 'quote' ? tabParam : 'post';
    const [parentPreviews, setParentPreviews] = useState<Record<string, ParentPreview>>({});
    const [shareCopied, setShareCopied] = useState(false);
    const lastMutationAtRef = useRef(0);
    const lastUsernameRef = useRef<string | undefined>(undefined);
    const requestSeqRef = useRef(0);
    const [ffModal, setFfModal] = useState<'followers' | 'following' | null>(null);
    const [ffList, setFfList] = useState<FollowListUser[]>([]);
    const [ffLoading, setFfLoading] = useState(false);
    const [ffPage, setFfPage] = useState(1);
    const [ffHasMore, setFfHasMore] = useState(false);
    const lastTrackedProfileViewRef = useRef<string | null>(null);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
    const [repostTargetId, setRepostTargetId] = useState<string | null>(null);
    const [quoteText, setQuoteText] = useState('');
    const [quoteGif, setQuoteGif] = useState<string | null>(null);
    const [isQuoteGifPickerOpen, setIsQuoteGifPickerOpen] = useState(false);
    const [isSubmittingRepost, setIsSubmittingRepost] = useState(false);

    const isMe = currentUser?.username === resolvedUsername;
    const navState = (location.state ?? {}) as { scrollY?: number };

    const loadFollowList = useCallback(async (type: 'followers' | 'following', nextPage = 1, append = false) => {
        if (!resolvedUsername) {
            return;
        }

        if (!append) {
            setFfModal(type);
            setFfList([]);
        }

        setFfLoading(true);
        try {
            const response = await api.get(`/users/${resolvedUsername}/${type}?page=${nextPage}`);
            const items = (response.data[type] ?? []) as FollowListUser[];
            setFfList((current) => (append ? [...current, ...items] : items));
            setFfPage(nextPage);
            setFfHasMore(items.length === 40);
        } catch {
            if (!append) {
                setFfList([]);
                setFfHasMore(false);
            }
        } finally {
            setFfLoading(false);
        }
    }, [resolvedUsername]);

    const fetchProfile = useCallback(async (showLoading = false) => {
        if (!resolvedUsername) {
            setLoading(false);
            return;
        }

        const cacheKey = `${resolvedUsername}:${activeTab}`;
        const cached = profileCache.get(cacheKey);

        if (!showLoading && cached && hasStableProfileMetrics(cached.profile) && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL) {
            setProfile(cached.profile);
            setPosts(cached.posts);
            setHasMore(cached.hasMore);
            setPage(1);
            return;
        }

        if (Date.now() - lastMutationAtRef.current < 4000) {
            return;
        }

        if (showLoading) {
            setLoading(true);
        }

        try {
            const requestSeq = ++requestSeqRef.current;
            const [profileResponse, postsResponse] = await Promise.all([
                api.get(`/users/${resolvedUsername}`),
                api.get(buildPostsUrl(resolvedUsername, activeTab, 1)),
            ]);

            if (requestSeq !== requestSeqRef.current) {
                return;
            }

            const fetchedProfile = profileResponse.data.user as ProfileData;
            const rawPosts = (postsResponse.data.posts ?? []) as ProfilePost[];
            const filteredPosts = activeTab === 'rt' ? rawPosts.filter((post) => post.type === 'rt') : rawPosts;
            const nextHasMore = Boolean(postsResponse.data.hasMore);

            setProfile(fetchedProfile);
            setPosts(filteredPosts);
            setHasMore(nextHasMore);
            setPage(1);

            profileCache.set(cacheKey, {
                profile: fetchedProfile,
                posts: filteredPosts,
                hasMore: nextHasMore,
                fetchedAt: Date.now(),
            });

            if (followOverride !== null && fetchedProfile.isFollowing === followOverride) {
                setFollowOverride(null);
                setFollowerCountOverride(null);
            }
        } catch (error) {
            console.error('Failed to fetch profile', error);
            setProfile(null);
            setPosts([]);
            setHasMore(false);
            setPage(1);
        } finally {
            if (showLoading) {
                setLoading(false);
            }
        }
    }, [activeTab, followOverride, resolvedUsername]);

    const loadMorePosts = useCallback(async () => {
        if (!resolvedUsername || isLoadingMore || !hasMore) {
            return;
        }

        setIsLoadingMore(true);
        try {
            const nextPage = page + 1;
            const response = await api.get(buildPostsUrl(resolvedUsername, activeTab, nextPage));
            const rawPosts = (response.data.posts ?? []) as ProfilePost[];
            const nextPosts = activeTab === 'rt' ? rawPosts.filter((post) => post.type === 'rt') : rawPosts;
            setPosts((current) => [...current, ...nextPosts]);
            setPage(nextPage);
            setHasMore(Boolean(response.data.hasMore));
        } catch (error) {
            console.error('Profile pagination failed', error);
        } finally {
            setIsLoadingMore(false);
        }
    }, [activeTab, hasMore, isLoadingMore, page, resolvedUsername]);

    useEffect(() => {
        const usernameChanged = lastUsernameRef.current !== resolvedUsername;
        lastUsernameRef.current = resolvedUsername;
        void fetchProfile(usernameChanged);
    }, [fetchProfile, resolvedUsername]);

    useEffect(() => {
        if (!hasMore || isLoadingMore) return;
        const sentinel = loadMoreSentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) void loadMorePosts();
        }, { rootMargin: '400px' });

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, isLoadingMore, loadMorePosts]);

    useEffect(() => {
        if (!resolvedUsername) {
            return;
        }

        const normalizedUsername = resolvedUsername.toLowerCase();
        if (lastTrackedProfileViewRef.current === normalizedUsername) {
            return;
        }

        lastTrackedProfileViewRef.current = normalizedUsername;
        trackAnalyticsEvent({
            eventType: 'profile_view',
            surface: 'profile_page',
            entityType: 'user',
            entityId: normalizedUsername,
        });
    }, [resolvedUsername]);

    useVisibilityRefresh(() => {
        if (!resolvedUsername) {
            return;
        }

        void fetchProfile().catch((error) => {
            console.error('Profile refresh failed', error);
        });
    }, { enabled: Boolean(resolvedUsername), minHiddenMs: 12000 });

    useEffect(() => {
        if (!resolvedUsername) {
            return;
        }

        const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void fetchProfile().catch((error) => {
                    console.error('Profile refresh failed', error);
                });
            }
        }, 30000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [fetchProfile, resolvedUsername]);

    useEffect(() => {
        const refresh = (event?: Event) => {
            const path = (event as CustomEvent<{ path?: string }> | undefined)?.detail?.path;
            if (path && path !== location.pathname) {
                return;
            }
            void fetchProfile(true);
        };

        window.addEventListener('refresh-route', refresh);
        return () => window.removeEventListener('refresh-route', refresh);
    }, [fetchProfile, location.pathname]);

    useEffect(() => {
        if (activeTab !== 'rt' && activeTab !== 'quote') {
            setParentPreviews({});
            return;
        }

        const parentIds = [...new Set(posts.map((post) => post.parentId).filter((parentId): parentId is string => Boolean(parentId)))];
        if (parentIds.length === 0) {
            setParentPreviews({});
            return;
        }

        let isCancelled = false;

        const loadParents = async () => {
            try {
                const response = await api.post('/posts/batch-preview', { ids: parentIds });
                if (!isCancelled) {
                    setParentPreviews(response.data.previews ?? {});
                }
            } catch (error) {
                console.error('Batch parent preview fetch failed', error);
                if (!isCancelled) {
                    setParentPreviews({});
                }
            }
        };

        void loadParents();

        return () => {
            isCancelled = true;
        };
    }, [activeTab, posts]);

    useEffect(() => {
        if (!shareCopied) {
            return;
        }

        const timeoutId = window.setTimeout(() => setShareCopied(false), 1800);
        return () => window.clearTimeout(timeoutId);
    }, [shareCopied]);

    const timelinePosts = useMemo<TimelinePost[]>(
        () => (
            profile
                ? posts.map((post) => applyInteractionSnapshot({
                    id: post.id,
                    content: post.content,
                    mediaUrl: post.mediaUrl,
                    mediaMimeType: post.mediaMimeType,
                    type: post.type,
                    parentId: post.parentId,
                    favCount: post.favCount ?? 0,
                    trashCount: post.trashCount ?? 0,
                    replyCount: post.replyCount ?? 0,
                    rtCount: post.rtCount ?? 0,
                    viewCount: post.viewCount ?? 0,
                    createdAt: post.createdAt,
                    authorUsername: profile.username,
                    authorProfilePic: profile.profilePic,
                    authorRole: profile.role,
                    communityId: post.communityId,
                    communitySlug: post.communitySlug,
                    communityName: post.communityName,
                    hasFav: post.hasFav,
                    hasTrash: post.hasTrash,
                    parentPreview: post.parentId ? (parentPreviews[post.parentId] ?? null) : null,
                }))
                : []
        ),
        [parentPreviews, posts, profile]
    );

    useScrollRestoration({
        storageKey: `profile-scroll:${resolvedUsername ?? 'unknown'}:${activeTab}`,
        ready: !loading,
        contentKey: `${activeTab}:${timelinePosts.length}:${hasMore ? 'more' : 'end'}:${ffModal ?? 'closed'}`,
        initialScrollY: navState.scrollY ?? null,
    });

    useBodyScrollLock(Boolean(ffModal || repostTargetId));

    const isFollowing = followOverride ?? profile?.isFollowing ?? false;
    const followerCount = followerCountOverride ?? profile?.followerCount ?? 0;
    const coverUrl = toAbsoluteUrl(profile?.coverPic ?? null);
    const completionScore = profileCompletion(profile);
    const totalFavCount = profile?.totalFavCount ?? 0;
    const totalTrashCount = profile?.totalTrashCount ?? 0;
    const avatarUrl = useMemo(
        () => getAvatarUrl(profile?.username ?? resolvedUsername, profile?.profilePic ?? null),
        [profile?.profilePic, profile?.username, resolvedUsername]
    );
    const profileCacheKey = `${resolvedUsername ?? 'unknown'}:${activeTab}`;

    useEffect(() => {
        const role = profile?.role ?? 'user';
        const seedPalette = buildSeedPalette(`${resolvedUsername ?? 'club-threads'}:${role}`, role);
        setAmbientPalette(seedPalette);

        let cancelled = false;
        void extractPaletteFromImage(avatarUrl, role, seedPalette).then((nextPalette) => {
            if (!cancelled) {
                setAmbientPalette(nextPalette);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [avatarUrl, profile?.role, resolvedUsername]);

    const roleVisual = ROLE_VISUALS[profile?.role ?? 'user'];
    const repostTarget = useMemo(
        () => timelinePosts.find((post) => post.id === repostTargetId) ?? null,
        [repostTargetId, timelinePosts]
    );

    const coverFallbackStyle = useMemo<CSSProperties>(() => ({
        backgroundColor: 'var(--bg-secondary)',
        backgroundImage: `
            linear-gradient(180deg, rgba(10, 15, 24, 0.08), rgba(10, 15, 24, 0.38)),
            radial-gradient(circle at 18% 20%, ${ambientPalette.secondary} 0%, transparent 34%),
            radial-gradient(circle at 82% 18%, ${ambientPalette.primary} 0%, transparent 32%),
            radial-gradient(circle at 56% 80%, ${ambientPalette.tertiary} 0%, transparent 44%),
            linear-gradient(135deg, rgba(99, 110, 128, 0.95), rgba(24, 32, 45, 0.98))
        `,
    }), [ambientPalette]);

    const toggleFollow = async () => {
        if (!profile || !resolvedUsername || isFollowUpdating) {
            return;
        }

        const previousProfile = profile;
        const nextIsFollowing = !isFollowing;
        const nextFollowerCount = Math.max(0, followerCount + (isFollowing ? -1 : 1));
        setIsFollowUpdating(true);
        lastMutationAtRef.current = Date.now();
        setFollowOverride(nextIsFollowing);
        setFollowerCountOverride(nextFollowerCount);
        setProfile({
            ...profile,
            isFollowing: nextIsFollowing,
            followerCount: nextFollowerCount,
        });

        try {
            if (isFollowing) {
                await api.delete(`/users/${resolvedUsername}/follow`);
            } else {
                await api.post(`/users/${resolvedUsername}/follow`);
                trackAnalyticsEvent({
                    eventType: 'follow',
                    surface: 'profile_page',
                    entityType: 'user',
                    entityId: resolvedUsername,
                });
            }
        } catch (error) {
            console.error('Follow state could not be changed', error);
            setProfile(previousProfile);
            setFollowOverride(null);
            setFollowerCountOverride(null);
        } finally {
            setIsFollowUpdating(false);
        }
    };

    const handleShareProfile = async () => {
        const url = `${window.location.origin}/users/${resolvedUsername}`;
        try {
            if (navigator.share) {
                await navigator.share({
                    title: `${resolvedUsername} profili`,
                    url,
                });
            } else if (navigator.clipboard) {
                await navigator.clipboard.writeText(url);
                setShareCopied(true);
            }
        } catch (error) {
            if ((error as Error)?.name !== 'AbortError') {
                console.error('Profile share failed', error);
            }
        }
    };

    const handleSharePost = useCallback(async (postId: string) => {
        const shareUrl = `${window.location.origin}/post/${postId}`;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'Club Threads', text: 'Buna bak.', url: shareUrl });
                return;
            }
            await navigator.clipboard.writeText(shareUrl);
        } catch (error) {
            console.error('Post share failed', error);
        }
    }, []);

    const handleInteract = useCallback(async (postId: string, type: 'fav' | 'trash') => {
        let totalFavDelta = 0;
        let totalTrashDelta = 0;

        const applyUpdate = (currentPosts: ProfilePost[]) => currentPosts.map((post) => {
            if (post.id !== postId) return post;

            const previousFavCount = post.favCount ?? 0;
            const previousTrashCount = post.trashCount ?? 0;
            let favCount = previousFavCount;
            let trashCount = previousTrashCount;
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

            totalFavDelta = favCount - previousFavCount;
            totalTrashDelta = trashCount - previousTrashCount;
            setInteractionSnapshot(post.id, { favCount, trashCount, hasFav, hasTrash });

            return { ...post, favCount, trashCount, hasFav, hasTrash };
        });

        setPosts((current) => applyUpdate(current));
        setProfile((current) => current ? {
            ...current,
            totalFavCount: Math.max(0, current.totalFavCount + totalFavDelta),
            totalTrashCount: Math.max(0, current.totalTrashCount + totalTrashDelta),
        } : current);

        const cached = profileCache.get(profileCacheKey);
        if (cached) {
            profileCache.set(profileCacheKey, {
                ...cached,
                profile: {
                    ...cached.profile,
                    totalFavCount: Math.max(0, cached.profile.totalFavCount + totalFavDelta),
                    totalTrashCount: Math.max(0, cached.profile.totalTrashCount + totalTrashDelta),
                },
                posts: applyUpdate(cached.posts),
            });
        }

        try {
            lastMutationAtRef.current = Date.now();
            await api.post(`/posts/${postId}/interact`, { type: type === 'fav' ? 'FAV' : 'TRASH' });
        } catch (error) {
            console.error('Profile interaction failed', error);
            void fetchProfile();
        }
    }, [fetchProfile, profileCacheKey]);

    const handleRepost = useCallback((postId: string) => {
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
        if (!repostTargetId || isSubmittingRepost) {
            return;
        }

        const previousPosts = posts;
        setIsSubmittingRepost(true);

        const updateRtCount = (currentPosts: ProfilePost[]) => currentPosts.map((post) =>
            post.id === repostTargetId ? { ...post, rtCount: (post.rtCount ?? 0) + 1 } : post
        );

        setPosts((current) => updateRtCount(current));

        const cached = profileCache.get(profileCacheKey);
        if (cached) {
            profileCache.set(profileCacheKey, {
                ...cached,
                posts: updateRtCount(cached.posts),
            });
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
            trackAnalyticsEvent({
                eventType: (quoteText.trim() || quoteGif) ? 'post_quote' : 'post_repost',
                surface: 'profile_page',
                entityType: 'post',
                entityId: repostTargetId,
            });
            closeRepostDialog();
        } catch (error) {
            console.error('Profile repost failed', error);
            setPosts(previousPosts);
            if (cached) {
                profileCache.set(profileCacheKey, cached);
            }
            setIsSubmittingRepost(false);
        }
    }, [closeRepostDialog, isSubmittingRepost, posts, profileCacheKey, quoteGif, quoteText, repostTargetId]);

    if (loading) {
        return <div className="mx-auto min-h-screen max-w-[600px] px-4 py-12 text-center text-text-muted"><Loader2 className="mx-auto h-8 w-8 animate-spin" /></div>;
    }

    if (!profile || !resolvedUsername) {
        return <div className="mx-auto min-h-screen max-w-[600px] px-4 py-16 text-center text-text-muted">Kullanici bulunamadi.</div>;
    }

    return (
        <div className="mx-auto min-h-screen max-w-[600px] border-x border-border bg-bg-primary pb-[calc(var(--mobile-tabbar-offset)+env(safe-area-inset-bottom)+2rem)] md:pb-10">
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

            <header className="sticky top-0 z-30 border-b border-border bg-bg-primary/92 backdrop-blur-md">
                <div className="flex items-center gap-3 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
                    <button
                        type="button"
                        onClick={() => {
                            if (window.history.length > 1) {
                                navigate(-1);
                                return;
                            }
                            navigate('/', withViewTransition({ replace: true }));
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-text-primary transition hover:bg-bg-secondary"
                        aria-label="Geri dön"
                    >
                        <ArrowLeft size={20} />
                    </button>

                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[20px] font-extrabold text-text-primary">{profile.username}</div>
                        <div className="text-[13px] text-text-secondary">{formatCount(profile.postCount)} post</div>
                    </div>

                    <button
                        type="button"
                        onClick={handleShareProfile}
                        className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-text-primary transition hover:bg-bg-secondary ${shareCopied ? 'bg-bg-secondary' : ''}`}
                        aria-label="Profili paylaş"
                        title={shareCopied ? 'Link kopyalandi' : 'Profili paylas'}
                    >
                        <Share2 size={18} />
                    </button>
                </div>
            </header>

            <section className="border-b border-border">
                <div className="relative">
                    <div className="relative h-[154px] w-full overflow-hidden bg-bg-secondary sm:h-[210px]" style={coverFallbackStyle}>
                        {coverUrl ? (
                            <img
                                src={coverUrl}
                                alt={`${profile.username} kapak`}
                                className="absolute inset-0 h-full w-full object-cover"
                            />
                        ) : null}
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,20,25,0.08)_0%,rgba(15,20,25,0.3)_100%)]" />
                    </div>

                    <div
                        className="absolute bottom-0 left-4 z-10 h-[94px] w-[94px] translate-y-1/2 overflow-hidden rounded-full border-4 border-bg-primary bg-bg-secondary sm:h-[128px] sm:w-[128px]"
                        style={{ boxShadow: `0 0 0 1px ${roleVisual.ring}` }}
                    >
                        <img src={avatarUrl} alt={profile.username} className="h-full w-full object-cover" />
                    </div>
                </div>

                <div className="px-4 pb-3 pt-[58px] sm:pt-[76px]">
                    <div className="flex items-center justify-end gap-2">
                        {isMe ? (
                            <Link
                                to="/settings"
                                viewTransition
                                className="inline-flex h-10 items-center justify-center rounded-full border border-border-subtle px-4 text-[15px] font-semibold text-text-primary transition hover:bg-bg-secondary"
                            >
                                Profili duzenle
                            </Link>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={() => {
                                        warmRouteModule('messages');
                                        navigate(`/messages/${profile.username}`, { viewTransition: true });
                                    }}
                                    disabled={!profile.canDm}
                                    aria-label={profile.canDm ? 'Mesaj at' : 'DM kapalı'}
                                    className="inline-flex h-10 items-center justify-center rounded-full border border-border-subtle px-4 text-[15px] font-semibold text-text-primary transition hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                    <span className="sm:hidden">
                                        <MessageCircle size={18} />
                                    </span>
                                    <span className="hidden sm:inline">Mesaj</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={toggleFollow}
                                    disabled={isFollowUpdating}
                                    aria-label={isFollowUpdating ? 'Bekle' : isFollowing ? 'Takiptesin' : 'Takip et'}
                                    className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                        isFollowing
                                            ? 'border border-border-subtle text-text-primary hover:bg-bg-secondary'
                                            : 'bg-text-primary text-inverse-primary hover:opacity-90'
                                    }`}
                                >
                                    <span className="sm:hidden">
                                        <UserPlus size={18} />
                                    </span>
                                    <span className="hidden sm:inline">{isFollowUpdating ? 'Bekle...' : isFollowing ? 'Takiptesin' : 'Takip et'}</span>
                                </button>
                            </>
                        )}
                    </div>

                    <div className="mt-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-[28px] font-extrabold leading-tight text-text-primary sm:text-[32px]">{profile.username}</h1>
                            <VerifiedBadge role={profile.role} size={20} />
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[15px] text-text-secondary">
                            <span>@{profile.username}</span>
                            <span aria-hidden="true">·</span>
                            <span
                                className="rounded-full px-2.5 py-0.5 text-[13px] font-medium"
                                style={{ backgroundColor: roleVisual.soft, color: roleVisual.accent }}
                            >
                                {roleLabel(profile.role)}
                            </span>
                            {!isMe && profile.followsYou ? (
                                <span className="rounded-full bg-bg-secondary px-2.5 py-0.5 text-[13px] font-medium text-text-primary">
                                    Seni takip ediyor
                                </span>
                            ) : null}
                        </div>

                        {profile.bio?.trim() ? (
                            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-6 text-text-primary">{profile.bio}</p>
                        ) : (
                            <p className="mt-3 text-[15px] leading-6 text-text-secondary">
                                {isMe ? 'Bio, kapak ve birkaç iyi post bu alanı tamamlar.' : 'Bu profil henüz bio eklememiş.'}
                            </p>
                        )}

                        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-text-secondary">
                            <div className="inline-flex items-center gap-1.5">
                                <Calendar size={16} />
                                <span>{format(new Date(profile.joinedAt), 'MMMM yyyy')} tarihinde katildi</span>
                            </div>
                            {profile.canDm && !isMe ? <span>DM acik</span> : null}
                            {isMe ? <span>Profil %{completionScore} tamam</span> : null}
                        </div>

                        <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px]">
                            <button
                                type="button"
                                onClick={() => void loadFollowList('following')}
                                className="text-text-secondary transition hover:text-text-primary"
                            >
                                <span className="font-bold text-text-primary">{formatCount(profile.followingCount)}</span> Takip edilen
                            </button>
                            <button
                                type="button"
                                onClick={() => void loadFollowList('followers')}
                                className="text-text-secondary transition hover:text-text-primary"
                            >
                                <span className="font-bold text-text-primary">{formatCount(followerCount)}</span> Takipci
                            </button>
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] text-text-secondary">
                            <span><span className="font-semibold text-text-primary">{formatCount(totalFavCount)}</span> fav aldi</span>
                            <span><span className="font-semibold text-text-primary">{formatCount(totalTrashCount)}</span> trash aldi</span>
                            {!isMe && isFollowing ? <span>Takip ediyorsun</span> : null}
                        </div>

                    </div>
                </div>
            </section>

            <div className="sticky top-[calc(env(safe-area-inset-top)+58px)] z-20 border-b border-border bg-bg-primary/95 backdrop-blur-md">
                <div className="grid grid-cols-3">
                    {[
                        { key: 'post', label: 'Postlar' },
                        { key: 'rt', label: 'Repostlar' },
                        { key: 'quote', label: 'Alintilar' },
                    ].map((tab) => {
                        const isActive = activeTab === tab.key;

                        return (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => {
                                    const nextParams = new URLSearchParams(searchParams);
                                    nextParams.set('tab', tab.key);
                                    setSearchParams(nextParams, { replace: true });
                                }}
                                className={`relative px-4 py-4 text-center text-[15px] font-medium transition ${isActive ? 'text-text-primary' : 'text-text-secondary hover:bg-bg-secondary'}`}
                            >
                                {tab.label}
                                <span
                                    className={`absolute bottom-0 left-1/2 h-1 w-16 -translate-x-1/2 rounded-full ${isActive ? 'bg-brand' : 'bg-transparent'}`}
                                />
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="border-b border-border">
                {timelinePosts.length === 0 ? (
                    <div className="px-4 py-14 text-center">
                        <div className="text-[20px] font-extrabold text-text-primary">
                            {activeTab === 'rt'
                                ? 'Henüz repost yok.'
                                : activeTab === 'quote'
                                    ? 'Henüz alinti yok.'
                                    : 'Henüz post yok.'}
                        </div>
                        <p className="mt-2 text-sm text-text-secondary">
                            {isMe ? 'İlk paylaşımı buradan başlat.' : 'Bu profil bu sekmede henüz içerik paylaşmamış.'}
                        </p>
                    </div>
                ) : (
                    timelinePosts.map((post) => (
                        <PostCard
                            key={post.id}
                            post={post}
                            className="bg-bg-primary"
                            onInteract={handleInteract}
                            onRepost={handleRepost}
                            onShare={handleSharePost}
                            onReply={() => void fetchProfile()}
                        />
                    ))
                )}

                {hasMore && (
                    <div ref={loadMoreSentinelRef} className="flex justify-center py-6">
                        {isLoadingMore && <Loader2 className="h-6 w-6 animate-spin text-text-muted" />}
                    </div>
                )}
            </div>

            {ffModal && (
                <div className="fixed inset-0 z-[70] bg-bg-primary md:flex md:items-center md:justify-center md:bg-overlay" onClick={() => setFfModal(null)}>
                    <div
                        onClick={(event) => event.stopPropagation()}
                        className="flex h-full w-full flex-col md:h-auto md:max-h-[72vh] md:w-full md:max-w-md md:rounded-[28px] md:border md:border-border-subtle md:bg-bg-primary md:shadow-[0_30px_80px_rgba(17,17,17,0.18)]"
                    >
                        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-3.5">
                            <button onClick={() => setFfModal(null)} className="rounded-full p-1.5 active:bg-bg-hover">
                                <ArrowLeft size={20} className="text-text-primary" />
                            </button>
                            <div>
                                <div className="text-base font-black text-text-primary">
                                    {ffModal === 'followers' ? 'Takipciler' : 'Takip edilenler'}
                                </div>
                                <div className="text-xs text-text-muted">@{resolvedUsername}</div>
                            </div>
                        </div>

                        <div className="native-sheet-scroll flex-1 overflow-y-auto pb-4">
                            {ffLoading && ffList.length === 0 ? (
                                <div className="flex items-center justify-center py-16">
                                    <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                                </div>
                            ) : ffList.length === 0 ? (
                                <div className="py-16 text-center text-sm text-text-muted">
                                    {ffModal === 'followers' ? 'Henüz takipçi yok' : 'Henüz kimseyi takip etmiyor'}
                                </div>
                            ) : (
                                <>
                                    {ffList.map((user) => (
                                        <Link
                                            key={user.id}
                                            to={`/users/${user.username}`}
                                            onClick={() => setFfModal(null)}
                                            className="flex items-center gap-3 px-5 py-3 transition active:bg-bg-secondary"
                                        >
                                            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-bg-secondary ring-1 ring-border-subtle">
                                                <img src={getAvatarUrl(user.username, user.profilePic)} alt={user.username} className="h-full w-full object-cover" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-[15px] font-bold text-text-primary">{user.username}</div>
                                                {user.bio && <div className="mt-0.5 line-clamp-2 text-xs leading-4 text-text-muted">{user.bio}</div>}
                                            </div>
                                        </Link>
                                    ))}
                                    {ffHasMore && (
                                        <div className="px-5 pt-3">
                                            <button
                                                type="button"
                                                onClick={() => void loadFollowList(ffModal, ffPage + 1, true)}
                                                disabled={ffLoading}
                                                className="inline-flex h-11 w-full items-center justify-center rounded-full border border-border bg-bg-primary text-sm font-semibold text-text-primary disabled:opacity-60"
                                            >
                                                {ffLoading ? 'Yukleniyor...' : 'Daha fazlasini goster'}
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
