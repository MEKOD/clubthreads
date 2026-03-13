import type { ElementType } from 'react';
import { Bell, Home, MessageCircle, Search, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useNotificationStore } from '../../store/notificationStore';
import { useDmStore } from '../../store/dmStore';

export function MobileTabBar() {
    const location = useLocation();
    const unreadCount = useNotificationStore((state) => state.unreadCount);
    const dmUnreadCount = useDmStore((state) => state.unreadCount);
    const currentPath = location.pathname;

    if (currentPath === '/compose' || currentPath.startsWith('/messages/')) {
        return null;
    }

    const tabs: Array<{ path: string; icon: ElementType; badge?: number }> = [
        { path: '/', icon: Home },
        { path: '/communities', icon: Users },
        { path: '/search', icon: Search },
        { path: '/notifications', icon: Bell, badge: unreadCount },
        { path: '/messages', icon: MessageCircle, badge: dmUnreadCount },
    ];


    const handleTabClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
        if (currentPath === path) {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            if (path === '/') {
                window.dispatchEvent(new CustomEvent('refresh-feed'));
            }
            window.dispatchEvent(new CustomEvent('refresh-route', {
                detail: { path },
            }));
        }
    };

    const isTabActive = (path: string) => {
        if (path === '/') return currentPath === '/';
        return currentPath === path || currentPath.startsWith(`${path}/`);
    };

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-40 h-[calc(var(--mobile-tabbar-offset)+env(safe-area-inset-bottom))] border-t border-border bg-bg-primary/94 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(15,20,25,0.08)] backdrop-blur-xl supports-[backdrop-filter]:bg-bg-primary/74 md:hidden">
            <div className="mx-auto grid h-[var(--mobile-tabbar-offset)] max-w-md grid-cols-5 items-center px-2 py-1.5">
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = isTabActive(tab.path);
                    const showBadge = (tab.badge ?? 0) > 0;

                    return (
                        <Link key={tab.path} to={tab.path} viewTransition onClick={(e) => handleTabClick(e, tab.path)} className="relative flex flex-col items-center gap-0.5 rounded-full p-2.5 overflow-visible">
                            <Icon
                                size={24}
                                strokeWidth={isActive ? 2.5 : 1.8}
                                className={isActive ? 'text-text-primary' : 'text-text-secondary'}
                            />
                            {showBadge && (
                                <span className="absolute -right-0.5 top-0 z-10 flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-inverse-primary ring-2 ring-bg-primary">
                                    {(tab.badge ?? 0) > 9 ? '9+' : tab.badge}
                                </span>
                            )}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
