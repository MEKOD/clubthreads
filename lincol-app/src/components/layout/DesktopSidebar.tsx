import type { ElementType } from 'react';
import { BarChart3, Bell, Clock3, Home, MessageCircle, Settings, Users } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useDmStore } from '../../store/dmStore';
import { getAvatarUrl } from '../../lib/axios';
import { warmRouteModule } from '../../lib/routeModules';

export function DesktopSidebar() {
    const location = useLocation();
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const unreadCount = useNotificationStore((state) => state.unreadCount);
    const dmUnreadCount = useDmStore((state) => state.unreadCount);

    const items: Array<{ path: string; label: string; icon: ElementType }> = [
        { path: '/', label: 'Ana akış', icon: Home },
        { path: '/search', label: 'En Son', icon: Clock3 },
        { path: '/communities', label: 'Communities', icon: Users },
        { path: '/messages', label: 'Mesajlar', icon: MessageCircle },
        { path: '/notifications', label: 'Bildirimler', icon: Bell },
        ...(user?.role === 'admin' ? [{ path: '/admin/analytics', label: 'Analitik', icon: BarChart3 }] : []),
        { path: '/settings', label: 'Ayarlar', icon: Settings },
    ];

    return (
        <aside className="fixed left-0 top-0 hidden h-screen w-[275px] flex-col items-end border-r border-border px-2 py-3 md:flex">
            <div className="native-sheet-scroll flex h-full w-[258px] min-h-0 flex-col overflow-y-auto px-3">
                <Link to="/" viewTransition className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-full transition-colors hover:bg-border">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-text-primary text-[11px] font-black text-inverse-primary">
                        CT
                    </div>
                </Link>

                <nav className="space-y-0.5">
                    {items.map((item) => {
                        const isActive =
                            location.pathname === item.path ||
                            (item.path !== '/' && location.pathname.startsWith(`${item.path}/`));
                        const Icon = item.icon;
                        const showBadge = item.path === '/notifications' && unreadCount > 0;
                        const showDmBadge = item.path === '/messages' && dmUnreadCount > 0;

                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                viewTransition
                                className={`flex items-center gap-5 rounded-full px-3 py-3 transition-colors hover:bg-border ${isActive ? 'font-bold text-text-primary' : 'text-text-primary'}`}
                            >
                                <div className="relative">
                                    <Icon size={26} strokeWidth={isActive ? 2.5 : 1.8} />
                                    {(showBadge || showDmBadge) && (
                                        <span className="absolute -right-2 -top-1.5 z-10 flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-inverse-primary ring-2 ring-bg-primary">
                                            {(item.path === '/messages' ? dmUnreadCount : unreadCount) > 99
                                                ? '99+'
                                                : item.path === '/messages'
                                                    ? dmUnreadCount
                                                    : unreadCount}
                                        </span>
                                    )}
                                </div>
                                <span className="text-xl tracking-[-0.01em]">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                <div className="mt-4">
                    <button
                        type="button"
                        onClick={() => {
                            warmRouteModule('compose');
                            navigate('/compose', {
                                state: {
                                    returnTo: location.pathname,
                                    scrollY: window.scrollY,
                                },
                                viewTransition: true,
                            });
                        }}
                        className="flex w-full items-center justify-center rounded-full bg-text-primary px-8 py-3 text-[17px] font-bold text-inverse-primary transition-colors hover:bg-bg-secondary"
                    >
                        Paylaş
                    </button>
                </div>

                <Link
                    to={user ? `/users/${user.username}` : '/login'}
                    viewTransition
                    className="mt-auto flex items-center gap-3 rounded-full p-3 transition-colors hover:bg-border"
                >
                    <div className="h-10 w-10 overflow-hidden rounded-full bg-border">
                        <img src={getAvatarUrl(user?.username, user?.profilePic)} alt={user?.username || 'profile'} className="h-full w-full object-cover" />
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-bold text-text-primary">{user?.username || 'Guest'}</div>
                        <div className="truncate text-[13px] text-text-secondary">@{user?.username || 'login'}</div>
                    </div>
                </Link>
            </div>
        </aside>
    );
}
