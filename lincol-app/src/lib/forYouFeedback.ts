export type ForYouPassiveSignalKind = 'open' | 'dwell';

export interface ForYouPassiveSignal {
    kind: ForYouPassiveSignalKind;
    postId: string;
    dwellMs?: number;
    at: number;
}

const FOR_YOU_PASSIVE_SIGNAL_EVENT = 'for-you-passive-signal';

export function emitForYouPassiveSignal(signal: Omit<ForYouPassiveSignal, 'at'>) {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new CustomEvent<ForYouPassiveSignal>(FOR_YOU_PASSIVE_SIGNAL_EVENT, {
        detail: {
            ...signal,
            at: Date.now(),
        },
    }));
}

export function addForYouPassiveSignalListener(listener: (signal: ForYouPassiveSignal) => void) {
    if (typeof window === 'undefined') {
        return () => { };
    }

    const handler = (event: Event) => {
        const detail = (event as CustomEvent<ForYouPassiveSignal>).detail;
        if (!detail?.kind || !detail.postId) {
            return;
        }
        listener(detail);
    };

    window.addEventListener(FOR_YOU_PASSIVE_SIGNAL_EVENT, handler);
    return () => window.removeEventListener(FOR_YOU_PASSIVE_SIGNAL_EVENT, handler);
}
