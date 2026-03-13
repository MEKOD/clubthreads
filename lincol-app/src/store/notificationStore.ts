import { create } from 'zustand';
import { api, API_URL } from '../lib/axios';
import { createAuthenticatedEventStream } from '../lib/authenticatedEventStream';
import { useAuthStore } from './authStore';
import { clearPushSubscription, ensurePushSubscription } from '../lib/push';

interface NotificationStore {
    unreadCount: number;
    setUnreadCount: (count: number) => void;
    fetchUnreadCount: () => Promise<void>;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
    unreadCount: 0,
    setUnreadCount: (count) => set({ unreadCount: count }),
    fetchUnreadCount: async () => {
        try {
            const response = await api.get('/notifications?limit=1');
            set({ unreadCount: response.data.unreadCount ?? 0 });
        } catch {
            // silently fail
        }
    },
}));

// ─── Global SSE + polling listener ──────────────────────────────────────────
// Initialised once from NavigationLayout so it stays alive across page changes.

let _started = false;
let _source: ReturnType<typeof createAuthenticatedEventStream> | null = null;
let _reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let _pollInterval: ReturnType<typeof setInterval> | null = null;

export function startNotificationListener() {
    if (_started) return;
    _started = true;

    const poll = () => {
        const token = useAuthStore.getState().token;
        if (token) {
            void useNotificationStore.getState().fetchUnreadCount();
        }
    };

    const ensurePolling = () => {
        if (_pollInterval) return;
        _pollInterval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                poll();
            }
        }, 30_000);
    };

    // Initial fetch
    poll();
    void ensurePushSubscription();

    // Polling fallback every 30s
    ensurePolling();

    // Also refresh on tab focus
    const onFocus = () => poll();
    window.addEventListener('focus', onFocus);

    // SSE real-time
    const connectSSE = () => {
        const token = useAuthStore.getState().token;
        if (!token) return;

        let retryDelay = 1000;

        const connect = () => {
            const nextSource = createAuthenticatedEventStream({
                url: `${API_URL}/notifications/stream`,
                token,
                onOpen: () => {
                    retryDelay = 1000;
                },
                onError: () => {
                    nextSource.close();
                    if (_source === nextSource) {
                        _source = null;
                    }
                    _reconnectTimeout = setTimeout(connect, retryDelay);
                    retryDelay = Math.min(retryDelay * 2, 30_000);
                },
            });
            _source = nextSource;
            _source.addEventListener('notification:new', () => {
                poll();
            });

            _source.addEventListener('notification:read', () => {
                useNotificationStore.getState().setUnreadCount(0);
            });
        };

        connect();
    };

    connectSSE();

    // Re-connect SSE if auth changes
    useAuthStore.subscribe((state, prev) => {
        if (state.token !== prev.token) {
            _source?.close();
            _source = null;
            if (_reconnectTimeout) clearTimeout(_reconnectTimeout);
            if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
            if (state.token) {
                connectSSE();
                ensurePolling();
                poll();
                void ensurePushSubscription();
            } else {
                useNotificationStore.getState().setUnreadCount(0);
                void clearPushSubscription(prev.token);
            }
        }
    });
}
