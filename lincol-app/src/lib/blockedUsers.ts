const STORAGE_KEY = 'blocked-usernames';

function readBlockedUsernames() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch {
        return [];
    }
}

function writeBlockedUsernames(usernames: string[]) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(usernames));
}

export function isUserBlocked(username: string) {
    if (typeof window === 'undefined') return false;
    return readBlockedUsernames().includes(username.toLowerCase());
}

export function blockUsername(username: string) {
    if (typeof window === 'undefined') return;
    const usernames = new Set(readBlockedUsernames());
    usernames.add(username.toLowerCase());
    writeBlockedUsernames([...usernames]);
}

export function unblockUsername(username: string) {
    if (typeof window === 'undefined') return;
    writeBlockedUsernames(readBlockedUsernames().filter((value) => value !== username.toLowerCase()));
}
