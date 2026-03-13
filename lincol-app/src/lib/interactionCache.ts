export interface InteractionSnapshot {
    favCount: number;
    trashCount: number;
    hasFav: boolean;
    hasTrash: boolean;
    updatedAt: number;
}

const interactionCache = new Map<string, InteractionSnapshot>();
const CACHE_TTL = 60_000;
const FRESH_TTL = 15_000;

export function getInteractionSnapshot(postId: string) {
    const snapshot = interactionCache.get(postId);
    if (!snapshot) {
        return null;
    }

    if (Date.now() - snapshot.updatedAt > CACHE_TTL) {
        interactionCache.delete(postId);
        return null;
    }

    return snapshot;
}

export function setInteractionSnapshot(postId: string, snapshot: Omit<InteractionSnapshot, 'updatedAt'>) {
    interactionCache.set(postId, {
        ...snapshot,
        updatedAt: Date.now(),
    });
}

export function hasFreshInteractionSnapshot(postId: string) {
    const snapshot = getInteractionSnapshot(postId);
    if (!snapshot) {
        return false;
    }

    return Date.now() - snapshot.updatedAt <= FRESH_TTL;
}

export function applyInteractionSnapshot<T extends {
    id: string;
    favCount: number;
    trashCount: number;
    hasFav?: boolean;
    hasTrash?: boolean;
}>(item: T): T {
    const snapshot = getInteractionSnapshot(item.id);

    if (!snapshot) {
        return item;
    }

    return {
        ...item,
        favCount: snapshot.favCount,
        trashCount: snapshot.trashCount,
        hasFav: snapshot.hasFav,
        hasTrash: snapshot.hasTrash,
    };
}
