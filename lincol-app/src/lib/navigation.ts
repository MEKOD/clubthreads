import type { Location, NavigateOptions } from 'react-router-dom';

export interface TimelineNavigationState {
    from?: string;
    scrollY?: number;
}

const SCROLL_STORAGE_PREFIX = 'route-scroll:';

export function getRouteTarget(location: Location) {
    return `${location.pathname}${location.search}${location.hash}`;
}

export function createTimelineNavigationState(
    location: Location,
    options: { scrollY?: number } = {}
): TimelineNavigationState {
    return {
        from: getRouteTarget(location),
        scrollY: options.scrollY ?? (typeof window === 'undefined' ? 0 : window.scrollY),
    };
}

export function readStoredScroll(key: string) {
    if (typeof window === 'undefined') {
        return null;
    }

    const value = window.sessionStorage.getItem(`${SCROLL_STORAGE_PREFIX}${key}`);
    if (!value) {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function storeScroll(key: string, scrollY: number) {
    if (typeof window === 'undefined') {
        return;
    }

    window.sessionStorage.setItem(`${SCROLL_STORAGE_PREFIX}${key}`, String(Math.max(0, Math.round(scrollY))));
}

export function withViewTransition<T extends NavigateOptions>(options: T): T {
    return {
        ...options,
        viewTransition: true,
    };
}
