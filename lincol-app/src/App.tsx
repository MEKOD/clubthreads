import { Component, lazy, Suspense, type ReactNode, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useThemeStore, applyTheme } from './store/themeStore';
import { NavigationLayout } from './layouts/NavigationLayout';
import { AnalyticsRuntime } from './components/analytics/AnalyticsRuntime';
import { loadRouteModule } from './lib/routeModules';

const CHUNK_RELOAD_KEY = 'lincol-route-chunk-reload';

function isRecoverableChunkError(error: unknown) {
  const message = typeof error === 'object' && error && 'message' in error
    ? String(error.message)
    : String(error ?? '');

  return /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload CSS/.test(message);
}

async function loadLazyModule<T>(loader: () => Promise<T>): Promise<T> {
  try {
    const module = await loader();
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    return module;
  } catch (error) {
    const hasRetried = window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1';
    if (isRecoverableChunkError(error) && !hasRetried) {
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
      window.location.reload();
      return new Promise<T>(() => undefined);
    }

    throw error;
  }
}

function lazyPage<T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) {
  return lazy(async () => {
    const module = await loadLazyModule(loader);
    return { default: module[exportName] as React.ComponentType };
  });
}

const Login = lazyPage(() => loadRouteModule('login'), 'Login');
const Register = lazyPage(() => loadRouteModule('register'), 'Register');
const Home = lazyPage(() => loadRouteModule('home'), 'Home');
const Settings = lazyPage(() => loadRouteModule('settings'), 'Settings');
const Compose = lazyPage(() => loadRouteModule('compose'), 'Compose');
const Profile = lazyPage(() => loadRouteModule('profile'), 'Profile');
const Notifications = lazyPage(() => loadRouteModule('notifications'), 'Notifications');
const Messages = lazyPage(() => loadRouteModule('messages'), 'Messages');
const Communities = lazyPage(() => loadRouteModule('communities'), 'Communities');
const CommunityDetailPage = lazyPage(() => loadRouteModule('communityDetail'), 'CommunityDetailPage');
const PostDetail = lazyPage(() => loadRouteModule('postDetail'), 'PostDetail');
const Discover = lazyPage(() => loadRouteModule('discover'), 'Discover');
const TopicFeed = lazyPage(() => loadRouteModule('topicFeed'), 'TopicFeed');
const Trends = lazyPage(() => loadRouteModule('trends'), 'Trends');
const AdminAnalytics = lazyPage(() => loadRouteModule('adminAnalytics'), 'AdminAnalytics');

function FullScreenLoader() {
  return <div className="min-h-screen bg-bg-primary" />;
}

function ShellContentLoader() {
  return (
    <div className="mx-auto min-h-screen max-w-[720px] bg-bg-primary px-3 py-3 md:px-0">
      <div className="overflow-hidden rounded-[28px] border border-border-subtle bg-bg-primary/90 shadow-[0_18px_60px_rgba(17,17,17,0.06)]">
        <div className="h-14 animate-pulse border-b border-border-subtle bg-bg-secondary/70" />
        <div className="space-y-4 p-4">
          <div className="h-24 animate-pulse rounded-[24px] bg-bg-secondary/70" />
          <div className="h-32 animate-pulse rounded-[24px] bg-bg-secondary/70" />
          <div className="h-32 animate-pulse rounded-[24px] bg-bg-secondary/70" />
        </div>
      </div>
    </div>
  );
}

interface RouteErrorBoundaryProps {
  children: ReactNode;
  resetKey: string;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Route render failed', error);
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-bg-primary px-6 text-text-primary">
          <div className="w-full max-w-sm rounded-3xl border border-border-subtle bg-bg-secondary p-6 text-center">
            <h1 className="text-lg font-bold">Sayfa yuklenemedi</h1>
            <p className="mt-2 text-sm text-text-secondary">
              Eski cache veya yarim kalmis bir guncelleme yakalanmis olabilir.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-text-primary px-5 text-sm font-semibold text-inverse-primary"
            >
              Yeniden yukle
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function RouteLoader({ children, fallback = <ShellContentLoader /> }: { children: ReactNode; fallback?: ReactNode }) {
  const location = useLocation();

  return (
    <RouteErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);

  if (!hydrated) {
    return <FullScreenLoader />;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);

  if (!hydrated) {
    return <FullScreenLoader />;
  }

  if (token) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function SelfProfileRedirect() {
  const user = useAuthStore((state) => state.user);
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={`/users/${user.username}`} replace />;
}

function App() {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    applyTheme(theme);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyTheme(theme);

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  return (
    <BrowserRouter>
      <AnalyticsRuntime />
      <Routes>
        <Route path="/login" element={(<RedirectIfAuthenticated><RouteLoader fallback={<FullScreenLoader />}><Login /></RouteLoader></RedirectIfAuthenticated>)} />
        <Route path="/register" element={(<RedirectIfAuthenticated><RouteLoader fallback={<FullScreenLoader />}><Register /></RouteLoader></RedirectIfAuthenticated>)} />

        <Route element={(<RequireAuth><NavigationLayout /></RequireAuth>)}>
          <Route path="/" element={<RouteLoader><Home /></RouteLoader>} />
          <Route path="/settings" element={<RouteLoader><Settings /></RouteLoader>} />
          <Route path="/compose" element={<RouteLoader><Compose /></RouteLoader>} />
          <Route path="/messages" element={<RouteLoader><Messages /></RouteLoader>} />
          <Route path="/messages/:username" element={<RouteLoader><Messages /></RouteLoader>} />
          <Route path="/notifications" element={<RouteLoader><Notifications /></RouteLoader>} />
          <Route path="/communities" element={<RouteLoader><Communities /></RouteLoader>} />
          <Route path="/communities/:slug" element={<RouteLoader><CommunityDetailPage /></RouteLoader>} />
          <Route path="/search" element={<RouteLoader><Discover /></RouteLoader>} />
          <Route path="/trends" element={<RouteLoader><Trends /></RouteLoader>} />
          <Route path="/admin/analytics" element={<RouteLoader><AdminAnalytics /></RouteLoader>} />
          <Route path="/topic/:keyword" element={<RouteLoader><TopicFeed /></RouteLoader>} />
          <Route path="/users/:username" element={<RouteLoader><Profile /></RouteLoader>} />
          <Route path="/profile" element={<SelfProfileRedirect />} />
          <Route path="/post/:id" element={<RouteLoader><PostDetail /></RouteLoader>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
