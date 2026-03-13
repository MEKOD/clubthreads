import { useEffect, useRef } from 'react';

interface VisibilityRefreshOptions {
    enabled?: boolean;
    minHiddenMs?: number;
}

export function useVisibilityRefresh(
    onVisible: () => void,
    { enabled = true, minHiddenMs = 12000 }: VisibilityRefreshOptions = {},
) {
    const hiddenAtRef = useRef<number | null>(null);

    useEffect(() => {
        if (!enabled) {
            return;
        }

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                hiddenAtRef.current = Date.now();
                return;
            }

            const hiddenAt = hiddenAtRef.current;
            hiddenAtRef.current = null;

            if (!hiddenAt) {
                return;
            }

            if (Date.now() - hiddenAt < minHiddenMs) {
                return;
            }

            onVisible();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [enabled, minHiddenMs, onVisible]);
}
