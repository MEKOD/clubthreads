const routeModuleLoaders = {
    login: () => import('../pages/Login'),
    register: () => import('../pages/Register'),
    home: () => import('../pages/Home'),
    settings: () => import('../pages/Settings'),
    compose: () => import('../pages/Compose'),
    profile: () => import('../pages/Profile'),
    notifications: () => import('../pages/Notifications'),
    messages: () => import('../pages/Messages'),
    communities: () => import('../pages/Communities'),
    communityDetail: () => import('../pages/CommunityDetailPage'),
    postDetail: () => import('../pages/PostDetail'),
    discover: () => import('../pages/Discover'),
    topicFeed: () => import('../pages/TopicFeed'),
    trends: () => import('../pages/Trends'),
    adminAnalytics: () => import('../pages/AdminAnalytics'),
} satisfies Record<string, () => Promise<unknown>>;

type RouteModuleMap = {
    [Key in keyof typeof routeModuleLoaders]: Awaited<ReturnType<(typeof routeModuleLoaders)[Key]>>;
};

export type RouteModuleKey = keyof typeof routeModuleLoaders;

const routeModuleCache = new Map<RouteModuleKey, Promise<unknown>>();

export function loadRouteModule<Key extends RouteModuleKey>(key: Key): Promise<RouteModuleMap[Key]> {
    const cachedModule = routeModuleCache.get(key) as Promise<RouteModuleMap[Key]> | undefined;
    if (cachedModule) {
        return cachedModule;
    }

    const modulePromise = routeModuleLoaders[key]() as Promise<RouteModuleMap[Key]>;
    routeModuleCache.set(key, modulePromise as Promise<unknown>);
    return modulePromise;
}

export function warmRouteModule(key: RouteModuleKey) {
    void loadRouteModule(key);
}

export function warmRouteModules(keys: readonly RouteModuleKey[]) {
    for (const key of keys) {
        warmRouteModule(key);
    }
}

export function getRouteModuleForPath(pathname: string): RouteModuleKey | null {
    if (pathname === '/login') return 'login';
    if (pathname === '/register') return 'register';
    if (pathname === '/') return 'home';
    if (pathname === '/settings') return 'settings';
    if (pathname === '/compose') return 'compose';
    if (pathname.startsWith('/users/')) return 'profile';
    if (pathname === '/notifications') return 'notifications';
    if (pathname === '/messages' || pathname.startsWith('/messages/')) return 'messages';
    if (pathname === '/communities') return 'communities';
    if (pathname.startsWith('/communities/')) return 'communityDetail';
    if (pathname === '/search') return 'discover';
    if (pathname.startsWith('/topic/')) return 'topicFeed';
    if (pathname === '/trends') return 'trends';
    if (pathname.startsWith('/post/')) return 'postDetail';
    if (pathname.startsWith('/admin/analytics')) return 'adminAnalytics';

    return null;
}

export function warmRouteForPath(pathname: string) {
    const key = getRouteModuleForPath(pathname);
    if (!key) {
        return;
    }

    warmRouteModule(key);
}

export function getLikelyNextRouteModules(pathname: string): RouteModuleKey[] {
    if (pathname === '/') {
        return ['compose', 'postDetail', 'profile', 'notifications'];
    }

    if (pathname === '/search' || pathname === '/trends' || pathname.startsWith('/topic/')) {
        return ['postDetail', 'profile', 'compose'];
    }

    if (pathname === '/notifications') {
        return ['postDetail', 'profile', 'messages'];
    }

    if (pathname.startsWith('/post/')) {
        return ['profile', 'compose', 'messages'];
    }

    if (pathname.startsWith('/users/')) {
        return ['postDetail', 'messages', 'settings'];
    }

    if (pathname === '/communities') {
        return ['communityDetail', 'postDetail', 'compose'];
    }

    if (pathname.startsWith('/communities/')) {
        return ['communities', 'postDetail', 'profile'];
    }

    if (pathname === '/messages' || pathname.startsWith('/messages/')) {
        return ['profile', 'postDetail'];
    }

    return [];
}
