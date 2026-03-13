import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Bell, Check, Heart, Loader2, MessageCircle, Repeat2, UserPlus, Users, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { API_URL, api, getAvatarUrl } from '../lib/axios';
import { createAuthenticatedEventStream } from '../lib/authenticatedEventStream';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useNotificationStore } from '../store/notificationStore';
import { useCommunityStore } from '../store/communityStore';
import { ensurePushSubscription, requestNotificationPermissionWithHint } from '../lib/push';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { createTimelineNavigationState, withViewTransition } from '../lib/navigation';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';
import { trackAnalyticsEvent } from '../lib/analytics';

interface ActivityNotification {
    id: string;
    type: 'follow' | 'fav' | 'reply' | 'rt' | 'quote' | 'mention' | 'community_invite' | 'community_join_request';
    actorId: string;
    actorUsername: string;
    actorProfilePic: string | null;
    postId: string | null;
    postContent: string | null;
    communityId: string | null;
    communitySlug: string | null;
    communityName: string | null;
    isRead: boolean;
    actionStatus?: 'accepted' | 'rejected' | null;
    resolvedAt?: string | null;
    createdAt: string;
}

interface SuggestedUser {
    id: string;
    username: string;
    bio: string | null;
    profilePic: string | null;
    mutualFollowCount: number;
    sharedCommunityCount: number;
    sharedFollowingCount: number;
    sharedFollowerCount: number;
    viewerLikedPostCount: number;
    likedViewerPostCount: number;
    profileViewCount: number;
}

function formatCountLabel(count: number, singular: string, plural: string) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function formatSuggestionReason(user: SuggestedUser) {
    if (user.mutualFollowCount > 0) {
        return `${formatCountLabel(user.mutualFollowCount, 'ortak baglanti', 'ortak baglanti')} seni bagliyor`;
    }

    if (user.sharedCommunityCount > 0) {
        return `${formatCountLabel(user.sharedCommunityCount, 'ortak topluluk', 'ortak topluluk')}`;
    }

    if (user.likedViewerPostCount > 0) {
        return 'Postlarini begenmis';
    }

    if (user.viewerLikedPostCount > 0) {
        return 'Postlarini begendin';
    }

    if (user.sharedFollowingCount > 0) {
        return 'Benzer hesaplari takip ediyorsunuz';
    }

    if (user.sharedFollowerCount > 0) {
        return 'Benzer bir cevrede gorunuyor';
    }

    if (user.profileViewCount > 0) {
        return 'Yakinda profiline baktin';
    }

    return 'Senin icin oneriliyor';
}

export function Notifications() {
    const location = useLocation();
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
    const [suggestedUsers, setSuggestedUsers] = useState<SuggestedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [actioningId, setActioningId] = useState<string | null>(null);
    const [followPendingByUsername, setFollowPendingByUsername] = useState<Record<string, boolean>>({});
    const unreadMarkedRef = useRef(false);
    const token = useAuthStore((state) => state.token);
    const bumpMembershipVersion = useCommunityStore((state) => state.bumpMembershipVersion);
    const setLastVisitedCommunitySlug = useCommunityStore((state) => state.setLastVisitedCommunitySlug);
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [permissionHint, setPermissionHint] = useState<string | null>(null);

    useEffect(() => {
        if ('Notification' in window) {
            setPermission(Notification.permission);
        } else {
            setPermission('denied');
        }
    }, []);

    const fetchNotifications = useCallback(async (markRead: boolean) => {
        try {
            const response = await api.get('/notifications');
            const items = response.data.notifications ?? [];
            setNotifications(items);

            if (markRead && !unreadMarkedRef.current && (response.data.unreadCount ?? 0) > 0) {
                await api.patch('/notifications/read');
                unreadMarkedRef.current = true;
                setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
                useNotificationStore.getState().setUnreadCount(0);
            }
        } catch (error) {
            console.error('Failed to fetch notifications', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchSuggestedUsers = useCallback(async () => {
        if (!token) {
            setSuggestedUsers([]);
            return;
        }

        try {
            const response = await api.get('/search/users/suggestions?limit=5');
            setSuggestedUsers(response.data.users ?? []);
        } catch (error) {
            console.error('Failed to fetch suggested users', error);
        }
    }, [token]);

    useEffect(() => {
        void fetchNotifications(true);
        void fetchSuggestedUsers();

        const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void fetchNotifications(false);
                void fetchSuggestedUsers();
            }
        }, 15000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [fetchNotifications, fetchSuggestedUsers]);

    useVisibilityRefresh(() => {
        void fetchNotifications(false);
        void fetchSuggestedUsers();
    }, { minHiddenMs: 12000 });

    useEffect(() => {
        if (!token) {
            return;
        }

        let source: ReturnType<typeof createAuthenticatedEventStream> | null = null;
        let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
        let retryDelay = 1000;
        let disposed = false;

        const connect = () => {
            if (disposed) return;
            const refresh = () => {
                void fetchNotifications(false);
            };

            const nextSource = createAuthenticatedEventStream({
                url: `${API_URL}/notifications/stream`,
                token,
                onOpen: () => {
                    retryDelay = 1000;
                },
                onError: () => {
                    nextSource.close();
                    if (source === nextSource) {
                        source = null;
                    }
                    if (!disposed) {
                        reconnectTimeout = setTimeout(connect, retryDelay);
                        retryDelay = Math.min(retryDelay * 2, 30_000);
                    }
                },
            });
            source = nextSource;
            source.addEventListener('notification:new', refresh);
            source.addEventListener('notification:read', refresh);
        };

        connect();

        return () => {
            disposed = true;
            source?.close();
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
        };
    }, [fetchNotifications, token]);

    const navState = (location.state ?? {}) as { scrollY?: number };
    const buildDetailState = () => createTimelineNavigationState(location, { scrollY: window.scrollY });

    useScrollRestoration({
        storageKey: 'notifications-scroll',
        ready: !loading,
        contentKey: `${notifications.length}:${suggestedUsers.length}`,
        initialScrollY: navState.scrollY ?? null,
    });

    useEffect(() => {
        const refresh = (event?: Event) => {
            const path = (event as CustomEvent<{ path?: string }> | undefined)?.detail?.path;
            if (path && path !== location.pathname) {
                return;
            }
            void fetchNotifications(false);
            void fetchSuggestedUsers();
        };

        window.addEventListener('refresh-route', refresh);
        return () => window.removeEventListener('refresh-route', refresh);
    }, [fetchNotifications, fetchSuggestedUsers, location.pathname]);

    const getIcon = (type: ActivityNotification['type']) => {
        switch (type) {
            case 'fav':
                return <Heart className="text-[#8ea900]" size={18} fill="currentColor" />;
            case 'follow':
                return <UserPlus className="text-text-primary" size={18} />;
            case 'reply':
                return <MessageCircle className="text-text-primary" size={18} />;
            case 'rt':
            case 'quote':
                return <Repeat2 className="text-text-primary" size={18} />;
            case 'mention':
                return <AtSign className="text-text-primary" size={18} />;
            case 'community_invite':
            case 'community_join_request':
                return <Users className="text-text-primary" size={18} />;
            default:
                return <Bell className="text-text-primary" size={18} />;
        }
    };

    const getText = (notification: ActivityNotification) => {
        const actor = notification.actorUsername || 'Biri';

        switch (notification.type) {
            case 'fav':
                return <span><span className="font-semibold">{actor}</span> postunu favladi</span>;
            case 'follow':
                return <span><span className="font-semibold">{actor}</span> seni takip etti</span>;
            case 'reply':
                return <span><span className="font-semibold">{actor}</span> postuna yorum birakti</span>;
            case 'rt':
                return <span><span className="font-semibold">{actor}</span> postunu yeniden paylasti</span>;
            case 'quote':
                return <span><span className="font-semibold">{actor}</span> postunu alintiladi</span>;
            case 'mention':
                return <span><span className="font-semibold">{actor}</span> senden bahsetti</span>;
            case 'community_invite':
                return <span><span className="font-semibold">{actor}</span> seni <span className="font-semibold">/{notification.communitySlug}</span> community’sine davet etti</span>;
            case 'community_join_request':
                return <span><span className="font-semibold">{actor}</span> <span className="font-semibold">/{notification.communitySlug}</span> icin katilma istegi gonderdi</span>;
            default:
                return <span>Yeni bildirim</span>;
        }
    };

    const handleCommunityInvite = async (notification: ActivityNotification, action: 'accept' | 'reject') => {
        if (!notification.communitySlug) return;
        setActioningId(notification.id);
        try {
            if (action === 'accept') {
                await api.post(`/communities/${notification.communitySlug}/join`);
                setLastVisitedCommunitySlug(notification.communitySlug);
            } else {
                await api.delete(`/communities/${notification.communitySlug}/invites/me`);
            }
            await api.patch(`/notifications/${notification.id}/resolve`, {
                actionStatus: action === 'accept' ? 'accepted' : 'rejected',
            });
            bumpMembershipVersion();
            setNotifications((current) => current.map((item) => item.id === notification.id ? {
                ...item,
                actionStatus: action === 'accept' ? 'accepted' : 'rejected',
                resolvedAt: new Date().toISOString(),
            } : item));
        } catch (error) {
            console.error('Community invite action failed', error);
        } finally {
            setActioningId(null);
        }
    };

    const handleCommunityRequest = async (notification: ActivityNotification, action: 'approve' | 'reject') => {
        if (!notification.communitySlug) return;
        setActioningId(notification.id);
        try {
            if (action === 'approve') {
                await api.post(`/communities/${notification.communitySlug}/requests/${notification.actorId}/approve`);
            } else {
                await api.delete(`/communities/${notification.communitySlug}/requests/${notification.actorId}`);
            }
            await api.patch(`/notifications/${notification.id}/resolve`, {
                actionStatus: action === 'approve' ? 'accepted' : 'rejected',
            });
            setNotifications((current) => current.map((item) => item.id === notification.id ? {
                ...item,
                actionStatus: action === 'approve' ? 'accepted' : 'rejected',
                resolvedAt: new Date().toISOString(),
            } : item));
        } catch (error) {
            console.error('Community request action failed', error);
        } finally {
            setActioningId(null);
        }
    };

    const requestPermissionFromNotifications = async () => {
        const result = await requestNotificationPermissionWithHint();
        if (result.permission !== 'unsupported') {
            setPermission(result.permission);
        }
        setPermissionHint(result.message ?? null);
        if (result.permission === 'granted') {
            await ensurePushSubscription();
        }
    };

    const handleFollowSuggestion = useCallback(async (username: string) => {
        if (followPendingByUsername[username]) {
            return;
        }

        setFollowPendingByUsername((current) => ({ ...current, [username]: true }));

        try {
            await api.post(`/users/${username}/follow`);
            trackAnalyticsEvent({
                eventType: 'follow',
                surface: 'notifications',
                entityType: 'user',
                entityId: username,
            });
            setSuggestedUsers((current) => current.filter((user) => user.username !== username));
        } catch (error) {
            console.error('Suggested follow failed', error);
        } finally {
            setFollowPendingByUsername((current) => {
                const next = { ...current };
                delete next[username];
                return next;
            });
        }
    }, [followPendingByUsername]);

    if (loading) {
        return <div className="mx-auto min-h-screen max-w-[720px] px-3 py-16 text-center text-text-muted"><Loader2 className="mx-auto h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="mx-auto min-h-screen max-w-[720px] px-3 py-3 md:px-0">
            <div className="rounded-[30px] border border-border-subtle bg-bg-primary/90 shadow-[0_18px_60px_rgba(17,17,17,0.06)]">
                <div className="border-b border-border-subtle px-5 py-5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-muted">Activity</div>
                    <h1 className="text-[28px] font-black tracking-tight text-text-primary">Bildirimler</h1>
                </div>

                {permission !== 'granted' && (
                    <div className="border-b border-border-subtle px-5 py-4">
                        <div className="rounded-2xl border border-border-subtle bg-bg-secondary p-4">
                            <p className="text-sm font-semibold text-text-primary">Anlik bildirimleri ac</p>
                            <p className="mt-1 text-xs text-text-secondary">
                                {permission === 'denied'
                                    ? 'Tarayici ayarlarindan bildirim iznini ac, sonra tekrar dene.'
                                    : 'Follow, mention, reply ve fav bildirimlerini arka planda almak icin izin ver.'}
                            </p>
                            {permissionHint && (
                                <p className="mt-2 text-xs text-text-muted">{permissionHint}</p>
                            )}
                            <button
                                type="button"
                                onClick={requestPermissionFromNotifications}
                                className="mt-3 rounded-full bg-text-primary px-4 py-2 text-xs font-semibold text-inverse-primary"
                            >
                                {permission === 'denied' ? 'Ayarlarindan Ac' : 'Bildirimleri Ac'}
                            </button>
                        </div>
                    </div>
                )}

                <div className="divide-y divide-black/6">
                    {notifications.length === 0 ? (
                        <div className="px-5 py-14 text-center text-sm text-text-secondary">
                            Henuz bir hareket yok.
                        </div>
                    ) : (
                        notifications.map((notification) => (
                            <article key={notification.id} className="flex gap-4 px-5 py-4">
                                <div className={`mt-1 flex h-10 w-10 items-center justify-center rounded-2xl ${notification.isRead ? 'bg-bg-tertiary' : 'bg-[#eef7cb]'}`}>
                                    {getIcon(notification.type)}
                                </div>

                                <div className="min-w-0 flex-1">
                                    <div className="mb-2 flex items-center gap-2">
                                        <Link to={`/users/${notification.actorUsername}`} className="h-8 w-8 overflow-hidden rounded-xl bg-bg-secondary">
                                            <img
                                                src={getAvatarUrl(notification.actorUsername, notification.actorProfilePic)}
                                                alt={notification.actorUsername}
                                                className="h-full w-full object-cover"
                                            />
                                        </Link>
                                        <span className="text-xs text-text-muted">
                                            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true }).replace('about ', '')}
                                        </span>
                                    </div>

                                    <p className="text-[15px] leading-7 text-text-primary">
                                        {getText(notification)}
                                    </p>

                                    {notification.communitySlug && (
                                        <Link
                                            to={`/communities/${notification.communitySlug}`}
                                            onClick={() => setLastVisitedCommunitySlug(notification.communitySlug)}
                                            className="mt-2 inline-flex rounded-full border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-bg-secondary"
                                        >
                                            /{notification.communitySlug} sayfasina bak
                                        </Link>
                                    )}

                                    {notification.actionStatus && (
                                        <div className="mt-3 inline-flex rounded-full border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary">
                                            {notification.actionStatus === 'accepted' ? 'Kabul edildi' : 'Reddedildi'}
                                        </div>
                                    )}

                                    {notification.type === 'community_invite' && notification.communitySlug && !notification.actionStatus && (
                                        <div className="mt-3 flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => void handleCommunityInvite(notification, 'accept')}
                                                disabled={actioningId === notification.id}
                                                className="inline-flex items-center gap-1.5 rounded-full bg-text-primary px-3 py-1.5 text-[11px] font-semibold text-inverse-primary disabled:opacity-50"
                                            >
                                                {actioningId === notification.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                Kabul et
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleCommunityInvite(notification, 'reject')}
                                                disabled={actioningId === notification.id}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-3 py-1.5 text-[11px] font-semibold text-text-secondary disabled:opacity-50"
                                            >
                                                <X size={14} />
                                                Reddet
                                            </button>
                                        </div>
                                    )}

                                    {notification.type === 'community_join_request' && notification.communitySlug && !notification.actionStatus && (
                                        <div className="mt-3 flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => void handleCommunityRequest(notification, 'approve')}
                                                disabled={actioningId === notification.id}
                                                className="inline-flex items-center gap-1.5 rounded-full bg-text-primary px-3 py-1.5 text-[11px] font-semibold text-inverse-primary disabled:opacity-50"
                                            >
                                                {actioningId === notification.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                Onayla
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleCommunityRequest(notification, 'reject')}
                                                disabled={actioningId === notification.id}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-3 py-1.5 text-[11px] font-semibold text-text-secondary disabled:opacity-50"
                                            >
                                                <X size={14} />
                                                Reddet
                                            </button>
                                        </div>
                                    )}

                                    {notification.postId && (
                                        <Link
                                            to={`/post/${notification.postId}`}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                navigate(`/post/${notification.postId}`, withViewTransition({ state: buildDetailState() }));
                                            }}
                                            className="mt-2 block rounded-2xl bg-bg-secondary px-4 py-3 text-sm text-text-secondary transition hover:bg-bg-secondary"
                                        >
                                            {notification.postContent || 'Posta git'}
                                        </Link>
                                    )}
                                </div>
                            </article>
                        ))
                    )}
                </div>

                {suggestedUsers.length > 0 && (
                    <section className="border-t border-border-subtle bg-bg-secondary/20 px-4 py-4 md:px-5">
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Oneri</div>
                                <div className="mt-1 flex items-center gap-2 text-[15px] font-semibold text-text-primary">
                                    <Users size={15} className="text-text-secondary" />
                                    Taniyor olabilecegin kisiler
                                </div>
                            </div>
                            <div className="rounded-full border border-border-subtle bg-bg-primary px-2.5 py-1 text-[11px] font-semibold text-text-muted">
                                {suggestedUsers.length}
                            </div>
                        </div>

                        <div className="space-y-2">
                            {suggestedUsers.map((user) => (
                                <div key={user.id} className="flex items-center gap-2.5 rounded-[20px] border border-border-subtle bg-bg-primary/85 px-3 py-2.5">
                                    <Link to={`/users/${user.username}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                                        <div className="h-10 w-10 overflow-hidden rounded-full bg-bg-secondary">
                                            <img src={getAvatarUrl(user.username, user.profilePic)} alt={user.username} className="h-full w-full object-cover" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="truncate text-[13px] font-semibold text-text-primary">@{user.username}</div>
                                            <div className="mt-0.5 line-clamp-1 text-[11px] text-text-muted">{formatSuggestionReason(user)}</div>
                                            {user.bio && <p className="mt-1 hidden text-[12px] leading-4 text-text-secondary md:line-clamp-1 md:block">{user.bio}</p>}
                                        </div>
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={() => void handleFollowSuggestion(user.username)}
                                        disabled={Boolean(followPendingByUsername[user.username])}
                                        className="shrink-0 rounded-full border border-border-subtle bg-bg-secondary px-3 py-1.5 text-[11px] font-semibold text-text-primary transition hover:border-text-primary/15 hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {followPendingByUsername[user.username] ? 'Bekle...' : 'Takip et'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
