import { useEffect, type CSSProperties } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MobileTabBar } from '../components/layout/MobileTabBar';
import { DesktopSidebar } from '../components/layout/DesktopSidebar';
import { RightRail } from '../components/layout/RightRail';
import { MobileTopBar } from '../components/layout/MobileTopBar';
import { startNotificationListener } from '../store/notificationStore';
import { startDmListener } from '../store/dmStore';
import { PWAInstallPrompt } from '../components/ui/PWAInstallPrompt';
import { NotificationPermissionPrompt } from '../components/ui/NotificationPermissionPrompt';
import { DmCryptoRelogPrompt } from '../components/ui/DmCryptoRelogPrompt';
import { getLikelyNextRouteModules, warmRouteForPath, warmRouteModules } from '../lib/routeModules';

export function NavigationLayout() {
  const location = useLocation();
  const isMessageThreadRoute = location.pathname.startsWith('/messages/');
  const isMessagesRoute =
    location.pathname === '/messages' || isMessageThreadRoute;
  const isAdminAnalyticsRoute = location.pathname.startsWith('/admin/analytics');
  const isProfileRoute = location.pathname.startsWith('/users/');
  const isCommunityDetailRoute = location.pathname.startsWith('/communities/') && location.pathname !== '/communities';
  const isComposeRoute = location.pathname === '/compose';

  useEffect(() => {
    startNotificationListener();
    startDmListener();
  }, []);

  useEffect(() => {
    const warmAnchorTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      try {
        const url = new URL(anchor.href, window.location.origin);
        if (url.origin !== window.location.origin) {
          return;
        }

        warmRouteForPath(url.pathname);
      } catch {
        // Ignore malformed hrefs.
      }
    };

    const handleTouchStart = (event: TouchEvent) => warmAnchorTarget(event.target);
    const handleMouseOver = (event: MouseEvent) => warmAnchorTarget(event.target);
    const handleFocusIn = (event: FocusEvent) => warmAnchorTarget(event.target);

    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('focusin', handleFocusIn, true);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('focusin', handleFocusIn, true);
    };
  }, []);

  useEffect(() => {
    const nextRoutes = getLikelyNextRouteModules(location.pathname);
    if (nextRoutes.length === 0) {
      return;
    }

    let timeoutId = 0;
    let idleId: number | null = null;
    const warm = () => warmRouteModules(nextRoutes);

    timeoutId = window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idleId = window.requestIdleCallback(() => warm(), { timeout: 1200 });
        return;
      }

      warm();
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
      if (idleId !== null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [location.pathname]);

  const shellVars = {
    '--mobile-header-offset': isMessagesRoute || isProfileRoute || isCommunityDetailRoute || isComposeRoute ? '0rem' : '3.5rem',
    '--mobile-tabbar-offset': isMessageThreadRoute || isComposeRoute ? '0rem' : '5rem',
  } as CSSProperties;

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary" style={shellVars}>
      <MobileTopBar />
      <div className={`mx-auto flex min-h-screen ${isMessagesRoute || isAdminAnalyticsRoute ? 'max-w-[1600px]' : 'max-w-[1280px]'}`}>
        <DesktopSidebar />

        <main
          className={`min-h-screen w-full flex-1 px-0 ${
            isMessageThreadRoute || isComposeRoute
              ? 'pb-0 pt-0'
              : 'pb-[calc(var(--mobile-tabbar-offset)+env(safe-area-inset-bottom))] pt-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))]'
          } md:ml-[275px] md:px-0 md:pb-0 md:pt-0 ${
            isMessagesRoute || isAdminAnalyticsRoute ? 'xl:max-w-none' : 'xl:max-w-[600px]'
          }`}
        >
          <Outlet />
        </main>

        {!isMessagesRoute && !isAdminAnalyticsRoute ? <RightRail /> : null}
      </div>

      <div className="block md:hidden">
        <MobileTabBar />
      </div>

      <DmCryptoRelogPrompt active={isMessagesRoute} />
      <PWAInstallPrompt />
      <NotificationPermissionPrompt />
    </div>
  );
}
