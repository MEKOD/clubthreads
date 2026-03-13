import { useEffect, useLayoutEffect, useRef } from 'react';
import { readStoredScroll, storeScroll } from '../lib/navigation';

const RESTORE_TIMEOUT_MS = 1500;
const RESTORE_TOLERANCE_PX = 2;

function canReachScrollTarget(targetY: number) {
    const maxScrollableY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return maxScrollableY + RESTORE_TOLERANCE_PX >= targetY;
}

function resolveRestoreTarget(storageKey: string, initialScrollY?: number | null) {
    return initialScrollY ?? readStoredScroll(storageKey);
}

export function useScrollRestoration(params: {
    storageKey: string;
    ready: boolean;
    contentKey?: string | number;
    initialScrollY?: number | null;
}) {
    const { storageKey, ready, contentKey, initialScrollY } = params;
    const restoreTargetY = resolveRestoreTarget(storageKey, initialScrollY);
    const restoreRequestKey = `${storageKey}:${initialScrollY ?? 'stored'}`;
    const restoredRequestKeyRef = useRef<string | null>(null);

    useEffect(() => {
        let currentScroll = window.scrollY;

        const handleScroll = () => {
            currentScroll = window.scrollY;
        };
        const saveScroll = () => {
            storeScroll(storageKey, currentScroll);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('pagehide', saveScroll);

        return () => {
            saveScroll();
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('pagehide', saveScroll);
        };
    }, [storageKey]);

    useLayoutEffect(() => {
        if (!ready || restoredRequestKeyRef.current === restoreRequestKey) {
            return;
        }

        restoredRequestKeyRef.current = restoreRequestKey;

        if (restoreTargetY === null) {
            return;
        }

        let frameId = 0;
        const startedAt = Date.now();

        const restore = () => {
            window.scrollTo({ top: restoreTargetY, behavior: 'auto' });

            const reachedTarget = Math.abs(window.scrollY - restoreTargetY) <= RESTORE_TOLERANCE_PX;
            if (reachedTarget || canReachScrollTarget(restoreTargetY) || Date.now() - startedAt >= RESTORE_TIMEOUT_MS) {
                return;
            }

            frameId = window.requestAnimationFrame(restore);
        };

        restore();

        return () => {
            if (frameId) {
                window.cancelAnimationFrame(frameId);
            }
        };
    }, [contentKey, ready, restoreRequestKey, restoreTargetY]);
}
