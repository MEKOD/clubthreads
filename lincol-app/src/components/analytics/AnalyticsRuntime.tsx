import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { inferAnalyticsSurface, installAnalyticsLifecycle, startAnalyticsSession, trackAnalyticsEvent } from '../../lib/analytics';
import { useAuthStore } from '../../store/authStore';

export function AnalyticsRuntime() {
    const location = useLocation();
    const token = useAuthStore((state) => state.token);
    const hydrated = useAuthStore((state) => state.hydrated);
    const lastPathRef = useRef<string | null>(null);

    useEffect(() => {
        installAnalyticsLifecycle();
    }, []);

    useEffect(() => {
        if (!hydrated || !token) {
            return;
        }

        startAnalyticsSession();
    }, [hydrated, token]);

    useEffect(() => {
        if (!hydrated || !token) {
            return;
        }

        const pathname = location.pathname;
        if (lastPathRef.current === pathname) {
            return;
        }
        lastPathRef.current = pathname;

        trackAnalyticsEvent({
            eventType: 'screen_view',
            surface: inferAnalyticsSurface(pathname),
            entityType: 'screen',
            entityId: pathname,
        });
    }, [hydrated, location.pathname, token]);

    return null;
}
