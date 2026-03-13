import { create } from 'zustand';
import type { CommunitySummary, ParentPreview, TimelinePost, TrendingKeyword } from '../lib/social';

export interface FeedCacheEntry {
    data: TimelinePost[];
    nextCursor: string | null;
    fetchedAt: number;
    exploreDepth?: number;
}

export interface ListCacheEntry<T> {
    data: T[];
    fetchedAt: number;
}

interface RailCacheEntry {
    communities: CommunitySummary[];
    topPosts: TimelinePost[];
    keywords: TrendingKeyword[];
    fetchedAt: number;
}

interface FeedCacheState {
    homeLatest: FeedCacheEntry | null;
    homeForYou: FeedCacheEntry | null;
    homeTrash: FeedCacheEntry | null;
    rail: RailCacheEntry | null;
    trendsKeywords: ListCacheEntry<TrendingKeyword> | null;
    trendFeeds: Record<string, FeedCacheEntry>;
    topicFeeds: Record<string, FeedCacheEntry>;
    communityLatestFeeds: Record<string, FeedCacheEntry>;
    communityPopularFeeds: Record<string, FeedCacheEntry>;
    communityTrashFeeds: Record<string, FeedCacheEntry>;
    parentPreviews: Record<string, ParentPreview>;
    setHomeLatest: (entry: FeedCacheEntry | null) => void;
    setHomeForYou: (entry: FeedCacheEntry | null) => void;
    setHomeTrash: (entry: FeedCacheEntry | null) => void;
    setRail: (entry: RailCacheEntry | null) => void;
    setTrendsKeywords: (entry: ListCacheEntry<TrendingKeyword> | null) => void;
    setTrendFeed: (keyword: string, entry: FeedCacheEntry) => void;
    setTopicFeed: (keyword: string, entry: FeedCacheEntry) => void;
    setCommunityLatestFeed: (slug: string, entry: FeedCacheEntry) => void;
    setCommunityPopularFeed: (slug: string, entry: FeedCacheEntry) => void;
    setCommunityTrashFeed: (slug: string, entry: FeedCacheEntry) => void;
    mergeParentPreviews: (previews: Record<string, ParentPreview>) => void;
}

export const useFeedCacheStore = create<FeedCacheState>((set) => ({
    homeLatest: null,
    homeForYou: null,
    homeTrash: null,
    rail: null,
    trendsKeywords: null,
    trendFeeds: {},
    topicFeeds: {},
    communityLatestFeeds: {},
    communityPopularFeeds: {},
    communityTrashFeeds: {},
    parentPreviews: {},
    setHomeLatest: (entry) => set({ homeLatest: entry }),
    setHomeForYou: (entry) => set({ homeForYou: entry }),
    setHomeTrash: (entry) => set({ homeTrash: entry }),
    setRail: (entry) => set({ rail: entry }),
    setTrendsKeywords: (entry) => set({ trendsKeywords: entry }),
    setTrendFeed: (keyword, entry) => set((state) => ({
        trendFeeds: {
            ...state.trendFeeds,
            [keyword]: entry,
        },
    })),
    setTopicFeed: (keyword, entry) => set((state) => ({
        topicFeeds: {
            ...state.topicFeeds,
            [keyword]: entry,
        },
    })),
    setCommunityLatestFeed: (slug, entry) => set((state) => ({
        communityLatestFeeds: {
            ...state.communityLatestFeeds,
            [slug]: entry,
        },
    })),
    setCommunityPopularFeed: (slug, entry) => set((state) => ({
        communityPopularFeeds: {
            ...state.communityPopularFeeds,
            [slug]: entry,
        },
    })),
    setCommunityTrashFeed: (slug, entry) => set((state) => ({
        communityTrashFeeds: {
            ...state.communityTrashFeeds,
            [slug]: entry,
        },
    })),
    mergeParentPreviews: (previews) => set((state) => ({
        parentPreviews: {
            ...state.parentPreviews,
            ...previews,
        },
    })),
}));

export function isCacheFresh<T extends { fetchedAt: number }>(entry: T | null | undefined, ttl: number) {
    return Boolean(entry && Date.now() - entry.fetchedAt < ttl);
}
