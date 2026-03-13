import { Link, useLocation } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import { getAvatarUrl } from '../../lib/axios';
import { useAuthStore } from '../../store/authStore';

export function MobileTopBar() {
    const user = useAuthStore((state) => state.user);
    const location = useLocation();
    const isProfileRoute = location.pathname.startsWith('/users/');
    const isCommunityDetailRoute = location.pathname.startsWith('/communities/') && location.pathname !== '/communities';

    if (
        location.pathname === '/compose' ||
        location.pathname === '/messages' ||
        location.pathname.startsWith('/messages/') ||
        isProfileRoute ||
        isCommunityDetailRoute
    ) {
        return null;
    }

    const handleRefresh = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });

        if (location.pathname === '/') {
            window.dispatchEvent(new CustomEvent('refresh-feed'));
        }

        window.dispatchEvent(new CustomEvent('refresh-route', {
            detail: { path: location.pathname },
        }));
    };

    return (
        <header className="fixed left-0 right-0 top-0 z-40 border-b border-border bg-bg-primary/92 pt-[env(safe-area-inset-top)] shadow-[0_4px_20px_rgba(15,20,25,0.05)] backdrop-blur-xl supports-[backdrop-filter]:bg-bg-primary/72 md:hidden">
            <div className="mx-auto flex h-[var(--mobile-header-offset)] max-w-md items-center justify-between px-4">
                <Link to={user ? `/users/${user.username}` : '/login'} viewTransition className="rounded-full">
                    <img
                        src={getAvatarUrl(user?.username, user?.profilePic)}
                        alt={user?.username || 'profile'}
                        className="h-8 w-8 rounded-full object-cover ring-1 ring-[#cfd9de]"
                    />
                </Link>

                <Link to="/" viewTransition className="text-[15px] font-black tracking-tight text-text-primary">
                    Club Threads
                </Link>

                <button
                    type="button"
                    onClick={handleRefresh}
                    aria-label="Sayfayi yenile"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition hover:bg-bg-secondary hover:text-text-primary active:scale-95"
                >
                    <RotateCw size={17} />
                </button>
            </div>
        </header>
    );
}
