const STORAGE_KEY = 'hidden-post-ids';

function readHiddenPostIds() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch {
        return [];
    }
}

function writeHiddenPostIds(ids: string[]) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function isPostHidden(postId: string) {
    if (typeof window === 'undefined') return false;
    return readHiddenPostIds().includes(postId);
}

export function hidePost(postId: string) {
    if (typeof window === 'undefined') return;
    const ids = new Set(readHiddenPostIds());
    ids.add(postId);
    writeHiddenPostIds([...ids]);
}

export function unhidePost(postId: string) {
    if (typeof window === 'undefined') return;
    writeHiddenPostIds(readHiddenPostIds().filter((id) => id !== postId));
}
