import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, BellOff, ArrowLeft, BarChart3, Loader2, Upload } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getAvatarUrl, toAbsoluteUrl } from '../lib/axios';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { ensurePushSubscription, requestNotificationPermissionWithHint } from '../lib/push';
import type { BlockedUser } from '../lib/social';
import { unblockUsername } from '../lib/blockedUsers';

export function Settings() {
    const { theme, setTheme } = useThemeStore();
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [username, setUsername] = useState('');
    const [bio, setBio] = useState('');
    const [rejectCommunityInvites, setRejectCommunityInvites] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
    const [isUploadingCover, setIsUploadingCover] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const coverInputRef = useRef<HTMLInputElement | null>(null);
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const setAuth = useAuthStore((state) => state.setAuth);
    const updateUser = useAuthStore((state) => state.updateUser);
    const logout = useAuthStore((state) => state.logout);
    const token = useAuthStore((state) => state.token);
    const normalizedUsername = username.trim().toLowerCase();
    const usernameValid = /^[a-zA-Z0-9._-]+$/.test(normalizedUsername) && normalizedUsername.length >= 3 && normalizedUsername.length <= 32;
    const bioLength = bio.length;
    const [permissionHint, setPermissionHint] = useState<string | null>(null);
    const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
    const [isLoadingBlocks, setIsLoadingBlocks] = useState(true);
    const [unblockingUsername, setUnblockingUsername] = useState<string | null>(null);

    useEffect(() => {
        if ('Notification' in window) {
            setPermission(Notification.permission);
        }
    }, []);

    useEffect(() => {
        if (user) {
            setUsername(user.username);
            setBio(user.bio ?? '');
            setRejectCommunityInvites(Boolean(user.rejectCommunityInvites));
        }
    }, [user]);

    useEffect(() => {
        let cancelled = false;

        const loadBlockedUsers = async () => {
            setIsLoadingBlocks(true);
            try {
                const response = await api.get('/users/blocks');
                if (!cancelled) {
                    setBlockedUsers((response.data.users ?? []) as BlockedUser[]);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('Engellenen kullanicilar alinamadi', error);
                    setBlockedUsers([]);
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingBlocks(false);
                }
            }
        };

        void loadBlockedUsers();

        return () => {
            cancelled = true;
        };
    }, []);

    const requestNotificationPermission = async () => {
        try {
            const result = await requestNotificationPermissionWithHint();
            if (result.permission !== 'unsupported') {
                setPermission(result.permission);
            }
            setPermissionHint(result.message ?? null);

            if (result.permission === 'granted') {
                await ensurePushSubscription();
                new Notification('Club Threads', {
                    body: 'Bildirimler açıldı.',
                    icon: '/pwa-192x192.png',
                });
            }
        } catch (error) {
            console.error('Bildirim izni istenirken hata:', error);
        }
    };

    const sendTestNotification = async () => {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        new Notification('Club Threads', {
            body: 'Test bildirimi basarili. Push izinlerin aktif.',
            icon: '/pwa-192x192.png',
        });
    };

    const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!user || !token) {
            return;
        }

        setIsSaving(true);
        try {
            const response = await api.patch('/auth/me', {
                username: username.trim(),
                bio: bio.trim(),
                rejectCommunityInvites,
            });

            const nextUser = {
                ...user,
                ...response.data.user,
            };

            if (response.data.token) {
                setAuth(nextUser, response.data.token);
            } else {
                updateUser(nextUser);
            }
        } catch (error) {
            console.error('Profil güncellenemedi', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleAvatarUpload = async (file: File | null) => {
        if (!file) {
            return;
        }

        setIsUploadingAvatar(true);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await api.post('/auth/me/avatar', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });

            updateUser({ profilePic: response.data.profilePic });
        } catch (error) {
            console.error('Avatar yüklenemedi', error);
        } finally {
            setIsUploadingAvatar(false);
        }
    };

    const handleCoverUpload = async (file: File | null) => {
        if (!file) return;

        setIsUploadingCover(true);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await api.post('/auth/me/cover', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });

            updateUser({ coverPic: response.data.coverPic });
        } catch (error) {
            console.error('Kapak görseli yüklenemedi', error);
        } finally {
            setIsUploadingCover(false);
        }
    };

    const handleLogout = () => {
        logout();
        navigate('/login', { replace: true });
    };

    const handleUnblock = async (targetUsername: string) => {
        setUnblockingUsername(targetUsername);
        try {
            await api.delete(`/users/${targetUsername}/block`);
            unblockUsername(targetUsername);
            setBlockedUsers((current) => current.filter((entry) => entry.username !== targetUsername));
        } catch (error) {
            console.error('Kullanici engeli kaldirilamadi', error);
        } finally {
            setUnblockingUsername(null);
        }
    };

    return (
        <div className="min-h-screen bg-bg-primary text-text-primary">
            <header className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))] z-30 flex items-center gap-4 border-b border-border-subtle bg-bg-primary/80 px-4 py-4 backdrop-blur-md md:top-0">
                <Link to="/" viewTransition className="p-2 -ml-2 hover:bg-bg-secondary rounded-full transition-colors hidden max-md:block">
                    <ArrowLeft size={24} />
                </Link>
                <h1 className="text-xl font-bold tracking-tight">Settings</h1>
            </header>

            <div className="p-4 max-w-lg mx-auto space-y-8">
                <section>
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">Profil</h2>

                    <form onSubmit={handleSave} className="bg-bg-secondary rounded-2xl p-5 border border-border-subtle space-y-4">
                        <div className="overflow-hidden rounded-2xl border border-border bg-bg-primary">
                            <div
                                className="h-28 w-full bg-[radial-gradient(circle_at_82%_12%,_#b5db62_0%,_#7ca246_24%,_#1a2128_52%,_#0d1014_100%)] bg-cover bg-center"
                                style={user?.coverPic ? { backgroundImage: `url(${toAbsoluteUrl(user.coverPic)})` } : undefined}
                            />
                            <div className="border-t border-border p-3">
                                <input
                                    ref={coverInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(event) => void handleCoverUpload(event.target.files?.[0] ?? null)}
                                />
                                <button
                                    type="button"
                                    onClick={() => coverInputRef.current?.click()}
                                    disabled={isUploadingCover}
                                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-primary px-3 py-2 text-sm font-medium"
                                >
                                    {isUploadingCover ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                    Kapak yükle
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-full overflow-hidden bg-bg-hover">
                                <img
                                    src={getAvatarUrl(user?.username, user?.profilePic)}
                                    alt={user?.username}
                                    className="w-full h-full object-cover"
                                />
                            </div>

                            <div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(event) => void handleAvatarUpload(event.target.files?.[0] ?? null)}
                                />

                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploadingAvatar}
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-bg-primary text-sm font-medium"
                                >
                                    {isUploadingAvatar ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                    Avatar yükle
                                </button>
                            </div>
                        </div>

                        <label className="block">
                            <span className="text-sm font-medium text-text-secondary">Username</span>
                            <input
                                value={username}
                                onChange={(event) => setUsername(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-border bg-bg-primary px-4 py-3 outline-none focus:border-border"
                                minLength={3}
                                maxLength={32}
                            />
                            <div className="mt-1 flex items-center justify-between text-xs">
                                <span className={username.length > 0 && !usernameValid ? 'text-red-500' : 'text-text-muted'}>
                                    Sadece harf, rakam, nokta, tire ve alt cizgi kullan.
                                </span>
                                <span className="text-text-muted">{username.length}/32</span>
                            </div>
                        </label>

                        <label className="block">
                            <span className="text-sm font-medium text-text-secondary">Bio</span>
                            <textarea
                                value={bio}
                                onChange={(event) => setBio(event.target.value)}
                                rows={4}
                                className="mt-2 w-full rounded-xl border border-border bg-bg-primary px-4 py-3 outline-none focus:border-border resize-none"
                                maxLength={500}
                            />
                            <div className="mt-1 text-right text-xs text-text-muted">{bioLength}/500</div>
                        </label>

                        <label className="flex items-center justify-between rounded-xl border border-border bg-bg-primary px-4 py-3">
                            <div>
                                <div className="text-sm font-medium text-text-primary">Community davetlerini reddet</div>
                                <div className="mt-1 text-xs text-text-secondary">Aciksa hic kimse sana community daveti gonderemez.</div>
                            </div>
                            <input
                                type="checkbox"
                                checked={rejectCommunityInvites}
                                onChange={(event) => setRejectCommunityInvites(event.target.checked)}
                                className="h-4 w-4 accent-text-primary"
                            />
                        </label>

                        <button
                            type="submit"
                            disabled={isSaving || !usernameValid}
                            className="w-full bg-text-primary text-inverse-primary py-3 rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isSaving && <Loader2 size={16} className="animate-spin" />}
                            Kaydet
                        </button>
                    </form>
                </section>

                <section>
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">Görünüm</h2>
                    <div className="bg-bg-primary rounded-2xl p-1 border border-border-subtle flex">
                        {(['light', 'dark', 'system'] as const).map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setTheme(t)}
                                className={`flex-1 py-2.5 text-sm font-semibold rounded-xl capitalize transition-colors ${theme === t
                                        ? 'bg-text-primary text-inverse-primary shadow-sm'
                                        : 'text-text-secondary hover:text-text-primary'
                                    }`}
                            >
                                {t === 'system' ? 'Sistem' : t === 'light' ? 'Açık' : 'Koyu'}
                            </button>
                        ))}
                    </div>
                </section>

                <section>
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">PWA Notifications</h2>

                    <div className="bg-bg-secondary rounded-2xl p-5 border border-border-subtle">
                        <div className="flex items-start gap-4">
                            <div className={`p-3 rounded-xl ${permission === 'granted' ? 'bg-text-primary text-inverse-primary' : 'bg-bg-primary text-text-secondary border border-border'}`}>
                                {permission === 'granted' ? <Bell size={24} /> : <BellOff size={24} />}
                            </div>

                            <div className="flex-1">
                                <h3 className="font-semibold text-lg mb-1">
                                    {permission === 'granted' ? 'Notifications Active' : 'Enable Notifications'}
                                </h3>
                                <p className="text-text-secondary text-sm leading-relaxed mb-4">
                                    {permission === 'granted'
                                        ? 'Bildirimler açık.'
                                        : permission === 'denied'
                                            ? 'Bildirim izni tarayıcı ayarlarından açılmalı.'
                                            : 'Anlık bildirim almak için izin ver.'}
                                </p>
                                {permissionHint && (
                                    <p className="mb-3 text-xs text-text-muted">{permissionHint}</p>
                                )}

                                {permission !== 'granted' && (
                                    <div className="space-y-2">
                                        <motion.button
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.97 }}
                                            onClick={requestNotificationPermission}
                                            className="w-full bg-text-primary text-inverse-primary py-3 rounded-xl font-medium"
                                        >
                                            {permission === 'denied' ? 'Tarayıcı Ayarlarından Aç' : 'İzin Ver'}
                                        </motion.button>
                                        {permission === 'denied' && (
                                            <p className="text-xs text-text-muted">
                                                iOS Safari: Ayarlar &gt; Safari &gt; Bildirimler. Android: Site ayarlarından izin ver.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {permission === 'granted' && (
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.97 }}
                                        onClick={sendTestNotification}
                                        className="w-full bg-bg-primary border border-border text-text-primary py-3 rounded-xl font-medium"
                                    >
                                        Test Bildirimi Gonder
                                    </motion.button>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                <section>
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">Engellenenler</h2>
                    <div className="bg-bg-secondary rounded-2xl border border-border-subtle">
                        {isLoadingBlocks ? (
                            <div className="flex items-center gap-2 px-4 py-4 text-sm text-text-secondary">
                                <Loader2 size={16} className="animate-spin" />
                                Yukleniyor
                            </div>
                        ) : blockedUsers.length === 0 ? (
                            <div className="px-4 py-4 text-sm text-text-secondary">
                                Engelledigin kimse yok.
                            </div>
                        ) : (
                            blockedUsers.map((blockedUser, index) => (
                                <div
                                    key={blockedUser.id}
                                    className={`flex items-center justify-between gap-3 px-4 py-4 ${index > 0 ? 'border-t border-border-subtle' : ''}`}
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="h-11 w-11 overflow-hidden rounded-full bg-bg-hover">
                                            <img
                                                src={getAvatarUrl(blockedUser.username, blockedUser.profilePic)}
                                                alt={blockedUser.username}
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-text-primary">@{blockedUser.username}</div>
                                            <div className="line-clamp-1 text-xs text-text-secondary">
                                                {blockedUser.bio?.trim() || 'Bio yok'}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void handleUnblock(blockedUser.username)}
                                        disabled={unblockingUsername === blockedUser.username}
                                        className="inline-flex h-10 items-center justify-center rounded-full border border-border bg-bg-primary px-4 text-sm font-semibold text-text-primary disabled:opacity-60"
                                    >
                                        {unblockingUsername === blockedUser.username ? 'Bekle...' : 'Engeli kaldir'}
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                {user?.role === 'admin' && (
                    <section>
                        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">Admin</h2>
                        <Link
                            to="/admin/analytics"
                            className="flex items-center justify-between gap-4 rounded-2xl border border-border-subtle bg-bg-secondary p-5 transition-colors hover:bg-bg-primary"
                        >
                            <div className="flex items-start gap-3">
                                <div className="rounded-2xl border border-border bg-bg-primary p-3 text-text-primary">
                                    <BarChart3 size={20} />
                                </div>
                                <div>
                                    <div className="text-base font-semibold text-text-primary">Ziyaretci Analitigi</div>
                                    <div className="mt-1 text-sm leading-6 text-text-secondary">
                                        Hangi kullanici ne zaman geldi, hangi sehirden baglandi ve hangi cihaz/os kullandi gor.
                                    </div>
                                </div>
                            </div>
                            <span className="text-sm font-semibold text-text-secondary">Ac</span>
                        </Link>
                    </section>
                )}

                <section>
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">Account</h2>
                    <div className="bg-bg-secondary rounded-2xl p-2 border border-border-subtle">
                        <button
                            type="button"
                            onClick={handleLogout}
                            className="w-full text-left px-4 py-3 hover:bg-bg-primary rounded-xl transition-colors font-medium text-red-500"
                        >
                            Çıkış Yap
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
