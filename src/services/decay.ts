import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { blocks, communities, communityMembers, follows, interactions, postCommunities, posts, users, polls, pollOptions, pollVotes } from "../db/schema";
import { inArray } from "drizzle-orm";
import { buildVisiblePostFilter } from "./communityVisibility";
import { withLinkPreview, type LinkPreview } from "./linkPreview";
import { buildViewerBlockFilter } from "./blocking";
import { getEntityBehaviorMetrics, type EntityBehaviorMetrics, type RedisAnalyticsReader } from "./analytics";
import { attachPostViewCounts } from "./postViews";

interface PopularCache {
    get: (key: string) => Promise<string | null>;
    set: (...args: any[]) => Promise<unknown>;
}

export interface FeedPost {
    id: string;
    userId: string;
    content: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    parentId: string | null;
    type: "post" | "rt" | "quote";
    favCount: number;
    trashCount: number;
    replyCount: number;
    rtCount: number;
    createdAt: Date;
    authorUsername: string;
    authorProfilePic: string | null;
    authorRole: "admin" | "elite" | "pink" | "user";
    communityId?: string | null;
    communitySlug?: string | null;
    communityName?: string | null;
    viewCount?: number;
    hasFav?: boolean;
    hasTrash?: boolean;
    linkPreview?: LinkPreview | null;
    poll?: any; // To be populated
}

export interface FeedOptions {
    cursor?: string;
    communityId?: string;
    followerId?: string;
    viewerId?: string;
    limit?: number;
}

export interface TopPost extends FeedPost {
    score: number;
}

interface PopularCandidateRow extends FeedPost {
    score: number;
    pollVoteCount?: number;
    communityIsPrivate?: boolean | null;
}

export interface HotKeyword {
    keyword: string;
    count: number;
}

/**
 * Helper to fetch polls for a list of posts in batch
 */
export async function enrichFeedWithPolls<T extends { id: string, poll?: any }>(feedPosts: T[], viewerId?: string): Promise<T[]> {
    if (feedPosts.length === 0) return feedPosts;

    const postIds = feedPosts.map(p => p.id);

    // 1. Fetch all associated polls
    const pollsList = await db.select().from(polls).where(inArray(polls.postId, postIds));
    if (pollsList.length === 0) return feedPosts;

    const pollIds = pollsList.map(p => p.id);

    // 2. Fetch options for these polls
    const optionsList = await db.select().from(pollOptions).where(inArray(pollOptions.pollId, pollIds)).orderBy(pollOptions.id);

    // 3. If viewerId exists, fetch their votes
    let userVotes: any[] = [];
    if (viewerId) {
        userVotes = await db.select().from(pollVotes).where(
            and(
                inArray(pollVotes.pollId, pollIds),
                eq(pollVotes.userId, viewerId)
            )
        );
    }

    // 4. Map them back to the feedPosts without repeated array scans.
    const optionsByPollId = new Map<string, typeof optionsList>();
    for (const option of optionsList) {
        const existing = optionsByPollId.get(option.pollId);
        if (existing) {
            existing.push(option);
        } else {
            optionsByPollId.set(option.pollId, [option]);
        }
    }

    const userVoteByPollId = new Map<string, typeof userVotes[number]>();
    for (const vote of userVotes) {
        userVoteByPollId.set(vote.pollId, vote);
    }

    const pollMap = new Map<string, any>();

    for (const poll of pollsList) {
        const pOpts = optionsByPollId.get(poll.id) ?? [];
        const userVote = userVoteByPollId.get(poll.id);

        pollMap.set(poll.postId, {
            ...poll,
            options: pOpts,
            userVotedOptionId: userVote ? userVote.optionId : null
        });
    }

    for (const post of feedPosts) {
        if (pollMap.has(post.id)) {
            post.poll = pollMap.get(post.id);
        }
    }

    return feedPosts;
}

function parseCursor(cursor?: string): { createdAt: Date; id: string } | null {
    if (!cursor) return null;

    const [iso, id] = cursor.split("|");
    if (!iso || !id) return null;

    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;

    return { createdAt, id };
}

function keywordStopWords(): string[] {
    return [
        "acaba", "ama", "ancak", "artık", "asla", "aslında", "az", "bana", "bazı", "belki", "ben",
        "beni", "benim", "bile", "bir", "biraz", "birçok", "biri", "birkaç", "birşey", "biz", "bize",
        "bizi", "bizim", "bu", "buna", "bunda", "bundan", "bunu", "bunun", "burada", "çok", "çünkü",
        "da", "daha", "de", "defa", "diye", "eğer", "en", "gibi", "göre", "hala", "hangi", "hatta",
        "hem", "hep", "hepsi", "her", "hiç", "için", "ile", "ise", "işte", "kez", "ki", "kim", "kimi",
        "mı", "mi", "mu", "mü", "nasıl", "ne", "neden", "nerde", "nerede", "nereye", "niye", "o", "olan",
        "olarak", "oldu", "olduğu", "olmaz", "olsun", "on", "ona", "ondan", "onlar", "onu", "onun",
        "orada", "oysa", "sana", "sanki", "şey", "siz", "size", "sizi", "sizin", "şu", "tüm", "ve",
        "veya", "ya", "yani"
    ];
}

export async function getLatestFeed(opts: FeedOptions = {}): Promise<FeedPost[]> {
    const limit = Math.min(opts.limit ?? 30, 100);
    const parsedCursor = parseCursor(opts.cursor);

    // Show everything: root posts, replies, RT/quotes — full firehose for maximum flow
    const whereClauses: ReturnType<typeof and>[] = [];

    if (parsedCursor) {
        whereClauses.push(
            or(
                lt(posts.createdAt, parsedCursor.createdAt),
                and(eq(posts.createdAt, parsedCursor.createdAt), lt(posts.id, parsedCursor.id))
            )!
        );
    }

    const hasFavSelect = opts.viewerId
        ? sql<boolean>`EXISTS(
            SELECT 1 FROM interactions i
            WHERE i.user_id = ${opts.viewerId}
              AND i.post_id = ${posts.id}
              AND i.type = 'FAV'
        )`
        : sql<boolean>`false`;

    const hasTrashSelect = opts.viewerId
        ? sql<boolean>`EXISTS(
            SELECT 1 FROM interactions i
            WHERE i.user_id = ${opts.viewerId}
              AND i.post_id = ${posts.id}
              AND i.type = 'TRASH'
        )`
        : sql<boolean>`false`;

    if (opts.communityId) {
        const postsFound = await db
            .select({
                id: posts.id,
                userId: posts.userId,
                content: posts.content,
                mediaUrl: posts.mediaUrl,
                mediaMimeType: posts.mediaMimeType,
                linkPreviewUrl: posts.linkPreviewUrl,
                linkPreviewTitle: posts.linkPreviewTitle,
                linkPreviewDescription: posts.linkPreviewDescription,
                linkPreviewImageUrl: posts.linkPreviewImageUrl,
                linkPreviewSiteName: posts.linkPreviewSiteName,
                parentId: posts.parentId,
                type: posts.type,
                favCount: posts.favCount,
                trashCount: posts.trashCount,
                replyCount: posts.replyCount,
                rtCount: posts.rtCount,
                createdAt: posts.createdAt,
                authorUsername: users.username,
                authorProfilePic: users.profilePic,
                authorRole: users.role,
                communityId: communities.id,
                communitySlug: communities.slug,
                communityName: communities.name,
                hasFav: hasFavSelect,
                hasTrash: hasTrashSelect,
            })
            .from(postCommunities)
            .innerJoin(posts, eq(postCommunities.postId, posts.id))
            .innerJoin(users, eq(posts.userId, users.id))
            .innerJoin(communities, eq(postCommunities.communityId, communities.id))
            .where(and(eq(postCommunities.communityId, opts.communityId), ...whereClauses))
            .orderBy(desc(posts.createdAt), desc(posts.id))
            .limit(limit);

        const postsWithViews = await attachPostViewCounts(postsFound.map((row) => withLinkPreview(row)));
        return enrichFeedWithPolls(postsWithViews as FeedPost[], opts.viewerId);
    }

    if (opts.followerId) {
        const postsFound = await db
            .select({
                id: posts.id,
                userId: posts.userId,
                content: posts.content,
                mediaUrl: posts.mediaUrl,
                mediaMimeType: posts.mediaMimeType,
                linkPreviewUrl: posts.linkPreviewUrl,
                linkPreviewTitle: posts.linkPreviewTitle,
                linkPreviewDescription: posts.linkPreviewDescription,
                linkPreviewImageUrl: posts.linkPreviewImageUrl,
                linkPreviewSiteName: posts.linkPreviewSiteName,
                parentId: posts.parentId,
                type: posts.type,
                favCount: posts.favCount,
                trashCount: posts.trashCount,
                replyCount: posts.replyCount,
                rtCount: posts.rtCount,
                createdAt: posts.createdAt,
                authorUsername: users.username,
                authorProfilePic: users.profilePic,
                authorRole: users.role,
                communityId: communities.id,
                communitySlug: communities.slug,
                communityName: communities.name,
                hasFav: hasFavSelect,
                hasTrash: hasTrashSelect,
            })
            .from(follows)
            .innerJoin(posts, eq(follows.followingId, posts.userId))
            .innerJoin(users, eq(posts.userId, users.id))
            .leftJoin(postCommunities, eq(postCommunities.postId, posts.id))
            .leftJoin(communities, eq(postCommunities.communityId, communities.id))
            .where(and(eq(follows.followerId, opts.followerId), buildVisiblePostFilter(opts.viewerId), ...whereClauses))
            .orderBy(desc(posts.createdAt), desc(posts.id))
            .limit(limit);

        const postsWithViews = await attachPostViewCounts(postsFound.map((row) => withLinkPreview(row)));
        return enrichFeedWithPolls(postsWithViews as FeedPost[], opts.viewerId);
    }

    const postsFound = await db
        .select({
            id: posts.id,
            userId: posts.userId,
            content: posts.content,
            mediaUrl: posts.mediaUrl,
            mediaMimeType: posts.mediaMimeType,
            linkPreviewUrl: posts.linkPreviewUrl,
            linkPreviewTitle: posts.linkPreviewTitle,
            linkPreviewDescription: posts.linkPreviewDescription,
            linkPreviewImageUrl: posts.linkPreviewImageUrl,
            linkPreviewSiteName: posts.linkPreviewSiteName,
            parentId: posts.parentId,
            type: posts.type,
            favCount: posts.favCount,
            trashCount: posts.trashCount,
            replyCount: posts.replyCount,
            rtCount: posts.rtCount,
            createdAt: posts.createdAt,
            authorUsername: users.username,
            authorProfilePic: users.profilePic,
            authorRole: users.role,
            communityId: communities.id,
            communitySlug: communities.slug,
            communityName: communities.name,
            hasFav: hasFavSelect,
            hasTrash: hasTrashSelect,
        })
        .from(posts)
        .innerJoin(users, eq(posts.userId, users.id))
        .leftJoin(postCommunities, eq(postCommunities.postId, posts.id))
        .leftJoin(communities, eq(postCommunities.communityId, communities.id))
        .where(and(buildVisiblePostFilter(opts.viewerId), ...whereClauses))
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(limit);

    const postsWithViews = await attachPostViewCounts(postsFound.map((row) => withLinkPreview(row)));
    return enrichFeedWithPolls(postsWithViews as FeedPost[], opts.viewerId);
}

export function getNextCursor(feed: Pick<FeedPost, "createdAt" | "id">[], requestedLimit: number): string | null {
    if (feed.length === 0 || feed.length < requestedLimit) return null;
    const last = feed[feed.length - 1];
    return `${last.createdAt.toISOString()}|${last.id}`;
}

export async function getTopPosts(window: "24h" | "7d" = "24h", limit = 10, viewerId?: string): Promise<TopPost[]> {
    return getScopedTopPosts({ window, limit, viewerId });
}

export async function getTopPostsWithAnalytics(
    analytics: RedisAnalyticsReader & PopularCache,
    window: "24h" | "7d" = "24h",
    limit = 10,
    viewerId?: string
): Promise<TopPost[]> {
    return getScopedTopPosts({ analytics, window, limit, viewerId });
}

export async function getCommunityTopPosts(communityId: string, window: "24h" | "7d" = "24h", limit = 10, viewerId?: string): Promise<TopPost[]> {
    return getScopedTopPosts({ window, limit, viewerId, communityId });
}

export async function getCommunityTopPostsWithAnalytics(
    analytics: RedisAnalyticsReader & PopularCache,
    communityId: string,
    window: "24h" | "7d" = "24h",
    limit = 10,
    viewerId?: string
): Promise<TopPost[]> {
    return getScopedTopPosts({ analytics, window, limit, viewerId, communityId });
}

export async function getCommunityTrashPosts(communityId: string, limit = 30, viewerId?: string): Promise<FeedPost[]> {
    const clampedLimit = Math.min(Math.max(limit, 1), 50);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const hasFavFragment = viewerId
        ? sql`EXISTS(SELECT 1 FROM interactions i WHERE i.user_id = ${viewerId} AND i.post_id = p.id AND i.type = 'FAV')`
        : sql`false`;
    const hasTrashFragment = viewerId
        ? sql`EXISTS(SELECT 1 FROM interactions i WHERE i.user_id = ${viewerId} AND i.post_id = p.id AND i.type = 'TRASH')`
        : sql`false`;

    const result = await db.execute<{
        id: string;
        userId: string;
        content: string | null;
        mediaUrl: string | null;
        mediaMimeType: string | null;
        linkPreviewUrl: string | null;
        linkPreviewTitle: string | null;
        linkPreviewDescription: string | null;
        linkPreviewImageUrl: string | null;
        linkPreviewSiteName: string | null;
        parentId: string | null;
        type: "post" | "rt" | "quote";
        favCount: number;
        trashCount: number;
        replyCount: number;
        rtCount: number;
        createdAt: Date;
        authorUsername: string;
        authorProfilePic: string | null;
        authorRole: "admin" | "elite" | "pink" | "user";
        communityId: string | null;
        communitySlug: string | null;
        communityName: string | null;
        hasFav: boolean;
        hasTrash: boolean;
    }>(sql`
        SELECT
            p.id,
            p.user_id AS "userId",
            p.content,
            p.media_url AS "mediaUrl",
            p.media_mime_type AS "mediaMimeType",
            p.link_preview_url AS "linkPreviewUrl",
            p.link_preview_title AS "linkPreviewTitle",
            p.link_preview_description AS "linkPreviewDescription",
            p.link_preview_image_url AS "linkPreviewImageUrl",
            p.link_preview_site_name AS "linkPreviewSiteName",
            p.parent_id AS "parentId",
            p.type,
            p.fav_count AS "favCount",
            p.trash_count AS "trashCount",
            p.reply_count AS "replyCount",
            p.rt_count AS "rtCount",
            p.created_at AS "createdAt",
            u.username AS "authorUsername",
            u.profile_pic AS "authorProfilePic",
            u.role AS "authorRole",
            c.id AS "communityId",
            c.slug AS "communitySlug",
            c.name AS "communityName",
            ${hasFavFragment} AS "hasFav",
            ${hasTrashFragment} AS "hasTrash"
        FROM posts p
        INNER JOIN users u ON p.user_id = u.id
        INNER JOIN post_communities pc ON pc.post_id = p.id
        INNER JOIN communities c ON c.id = pc.community_id
        WHERE pc.community_id = ${communityId}
          AND p.trash_count > 0
          AND p.created_at > ${sevenDaysAgo}
          AND ${buildViewerBlockFilter(viewerId, sql`p.user_id`)}
        ORDER BY p.trash_count DESC, p.created_at DESC
        LIMIT ${clampedLimit}
    `);

    const mappedRows = (result.rows as Array<any>).map((row) => ({
        ...withLinkPreview(row),
        createdAt: new Date(row.createdAt),
        favCount: Number(row.favCount) || 0,
        replyCount: Number(row.replyCount) || 0,
        rtCount: Number(row.rtCount) || 0,
        trashCount: Number(row.trashCount) || 0,
    })) as Array<FeedPost>;

    const postsWithViews = await attachPostViewCounts(mappedRows);
    return enrichFeedWithPolls(postsWithViews as FeedPost[], viewerId);
}

function safeRate(numerator: number, denominator: number, floor = 0): number {
    return numerator / Math.max(denominator, floor || 1);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function computeQualifiedDwell(metrics: EntityBehaviorMetrics) {
    const avgDwellMs = metrics.dwellCount > 0 ? metrics.dwellTotalMs / metrics.dwellCount : 0;
    const sustainedDwellBonus = Math.max(0, avgDwellMs - 2500) / 1000;
    return metrics.dwellCount * 0.7 + sustainedDwellBonus;
}

function computePopularScore(candidate: PopularCandidateRow, metrics: EntityBehaviorMetrics, window: "24h" | "7d") {
    const impressions = Math.max(metrics.impressionCount, 0);
    const sampleFloor = window === "7d" ? 18 : 10;
    const normalizedExposure = Math.max(impressions, sampleFloor);
    const opens = metrics.openCount;
    const qualifiedDwell = computeQualifiedDwell(metrics);
    const effectiveReplies = Math.max(candidate.replyCount, metrics.replySubmitCount);
    const effectiveQuotes = metrics.quoteCount;
    const effectiveReposts = Math.max(candidate.rtCount, metrics.repostCount + metrics.quoteCount);
    const effectiveLikes = Math.max(candidate.favCount, metrics.likeCount);
    const effectiveTrash = Math.max(candidate.trashCount, metrics.trashCount);
    const pollVotes = candidate.pollVoteCount ?? 0;
    const ageHours = Math.max(0.25, (Date.now() - candidate.createdAt.getTime()) / (1000 * 60 * 60));

    const reactionMass =
        effectiveReplies * 7.5 +
        effectiveQuotes * 7 +
        effectiveReposts * 5.5 +
        effectiveLikes * 2.6 +
        opens * 2.4 +
        qualifiedDwell * 3.1 +
        pollVotes * 2.4 +
        effectiveTrash * 1.1;

    const replyRate = safeRate(effectiveReplies, normalizedExposure, sampleFloor);
    const repostRate = safeRate(effectiveReposts, normalizedExposure, sampleFloor);
    const openRate = safeRate(opens, normalizedExposure, sampleFloor);
    const dwellRate = safeRate(qualifiedDwell, normalizedExposure, sampleFloor);
    const trashRate = safeRate(effectiveTrash, normalizedExposure, sampleFloor);
    const curiosityBlend = openRate * 24 + dwellRate * 26;
    const conversationBlend = replyRate * 42 + repostRate * 28;
    const delightMix = safeRate(effectiveReplies + effectiveReposts + opens, Math.max(effectiveLikes, 1), 1) * 5.5;
    const pollBoost = pollVotes > 0 ? Math.min(16, Math.log1p(pollVotes) * 3.2) : 0;
    const negativityPenalty = Math.max(0, trashRate - 0.16) * 72 + Math.max(0, safeRate(effectiveTrash, effectiveLikes + effectiveReplies + effectiveReposts + 1, 1) - 0.45) * 32;
    const coldStartConfidence = 1 - Math.exp(-normalizedExposure / (window === "7d" ? 32 : 20));
    const recencyDecay = window === "7d"
        ? 1 / Math.pow(ageHours + 3, 0.63)
        : 1 / Math.pow(ageHours + 2, 0.74);

    return (reactionMass + curiosityBlend + conversationBlend + delightMix + pollBoost - negativityPenalty) * coldStartConfidence * recencyDecay;
}

function serializePopularCandidates(candidates: PopularCandidateRow[]) {
    return JSON.stringify(candidates);
}

function deserializePopularCandidates(input: string): PopularCandidateRow[] {
    const parsed = JSON.parse(input) as Array<PopularCandidateRow & { createdAt: string }>;
    return parsed.map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt),
    }));
}

async function hydrateViewerPopularState(candidates: PopularCandidateRow[], viewerId?: string, limit = 10): Promise<TopPost[]> {
    if (candidates.length === 0) {
        return [];
    }

    let filtered = candidates;

    if (viewerId) {
        const candidateUserIds = [...new Set(candidates.map((candidate) => candidate.userId))];
        const candidateCommunityIds = [...new Set(candidates.map((candidate) => candidate.communityId).filter((value): value is string => Boolean(value)))];

        const [blockedRows, membershipRows] = await Promise.all([
            candidateUserIds.length > 0
                ? db
                    .select({ blockedId: blocks.blockedId })
                    .from(blocks)
                    .where(and(eq(blocks.blockerId, viewerId), inArray(blocks.blockedId, candidateUserIds)))
                : Promise.resolve([]),
            candidateCommunityIds.length > 0
                ? db
                    .select({ communityId: communityMembers.communityId })
                    .from(communityMembers)
                    .where(and(eq(communityMembers.userId, viewerId), inArray(communityMembers.communityId, candidateCommunityIds)))
                : Promise.resolve([]),
        ]);

        const blockedSet = new Set(blockedRows.map((row) => row.blockedId));
        const membershipSet = new Set(membershipRows.map((row) => row.communityId));

        filtered = candidates.filter((candidate) => {
            if (blockedSet.has(candidate.userId)) {
                return false;
            }

            if (!candidate.communityId || !candidate.communityIsPrivate) {
                return true;
            }

            return membershipSet.has(candidate.communityId);
        });
    } else {
        filtered = candidates.filter((candidate) => !candidate.communityId || !candidate.communityIsPrivate);
    }

    const selected = filtered.slice(0, limit);
    if (selected.length === 0) {
        return [];
    }

    if (!viewerId) {
        return enrichFeedWithPolls(
            selected.map((candidate) => ({
                ...candidate,
                hasFav: false,
                hasTrash: false,
            })) as TopPost[],
            viewerId
        );
    }

    const interactionRows = await db
        .select({
            postId: interactions.postId,
            type: interactions.type,
        })
        .from(interactions)
        .where(and(eq(interactions.userId, viewerId), inArray(interactions.postId, selected.map((candidate) => candidate.id))));

    const stateByPostId = new Map<string, { hasFav: boolean; hasTrash: boolean }>();
    for (const row of interactionRows) {
        const current = stateByPostId.get(row.postId) ?? { hasFav: false, hasTrash: false };
        if (row.type === "FAV") current.hasFav = true;
        if (row.type === "TRASH") current.hasTrash = true;
        stateByPostId.set(row.postId, current);
    }

    return enrichFeedWithPolls(
        selected.map((candidate) => {
            const state = stateByPostId.get(candidate.id);
            return {
                ...candidate,
                hasFav: state?.hasFav ?? false,
                hasTrash: state?.hasTrash ?? false,
            };
        }) as TopPost[],
        viewerId
    );
}

async function getScopedTopPosts(opts: { analytics?: (RedisAnalyticsReader & PopularCache); window: "24h" | "7d"; limit: number; viewerId?: string; communityId?: string }): Promise<TopPost[]> {
    const clampedLimit = Math.min(Math.max(opts.limit, 1), 50);
    const interval = opts.window === "7d" ? sql.raw(`INTERVAL '7 days'`) : sql.raw(`INTERVAL '24 hours'`);
    const candidateLimit = clamp(clampedLimit * 8, clampedLimit, 250);
    const cacheKey = opts.analytics
        ? `popular:v3:${opts.communityId ?? "global"}:${opts.window}:${candidateLimit}`
        : null;

    if (opts.analytics && cacheKey) {
        try {
            const cached = await opts.analytics.get(cacheKey);
            if (cached) {
                const cachedCandidates = deserializePopularCandidates(cached);
                return hydrateViewerPopularState(cachedCandidates, opts.viewerId, clampedLimit);
            }
        } catch {
            // Cache is an optimization; fall through to live computation.
        }
    }

    const communityFilter = opts.communityId ? sql`pc.community_id = ${opts.communityId}` : sql`true`;

    const result = await db.execute<{
        id: string;
        userId: string;
        content: string | null;
        mediaUrl: string | null;
        mediaMimeType: string | null;
        linkPreviewUrl: string | null;
        linkPreviewTitle: string | null;
        linkPreviewDescription: string | null;
        linkPreviewImageUrl: string | null;
        linkPreviewSiteName: string | null;
        parentId: string | null;
        type: "post" | "rt" | "quote";
        favCount: number;
        trashCount: number;
        replyCount: number;
        rtCount: number;
        createdAt: Date;
        authorUsername: string;
        authorProfilePic: string | null;
        authorRole: "admin" | "elite" | "pink" | "user";
        communityId: string | null;
        communitySlug: string | null;
        communityName: string | null;
        communityIsPrivate: boolean | null;
        score: number;
        pollVoteCount: number;
    }>(sql`
        SELECT
            p.id,
            p.user_id AS "userId",
            p.content,
            p.media_url AS "mediaUrl",
            p.media_mime_type AS "mediaMimeType",
            p.link_preview_url AS "linkPreviewUrl",
            p.link_preview_title AS "linkPreviewTitle",
            p.link_preview_description AS "linkPreviewDescription",
            p.link_preview_image_url AS "linkPreviewImageUrl",
            p.link_preview_site_name AS "linkPreviewSiteName",
            p.parent_id AS "parentId",
            p.type,
            p.fav_count AS "favCount",
            p.trash_count AS "trashCount",
            p.reply_count AS "replyCount",
            p.rt_count AS "rtCount",
            p.created_at AS "createdAt",
            u.username AS "authorUsername",
            u.profile_pic AS "authorProfilePic",
            u.role AS "authorRole",
            c.id AS "communityId",
            c.slug AS "communitySlug",
            c.name AS "communityName",
            c.is_private AS "communityIsPrivate",
            ((p.fav_count * 1.0) + (p.reply_count * 1.5) + (p.rt_count * 2.0) - (p.trash_count * 1.25)) AS score,
            COALESCE((
                SELECT SUM(po.vote_count)::int
                FROM polls poll
                INNER JOIN poll_options po ON po.poll_id = poll.id
                WHERE poll.post_id = p.id
            ), 0) AS "pollVoteCount"
        FROM posts p
        INNER JOIN users u ON u.id = p.user_id
        LEFT JOIN post_communities pc ON pc.post_id = p.id
        LEFT JOIN communities c ON c.id = pc.community_id
        WHERE p.parent_id IS NULL
          AND p.created_at >= NOW() - ${interval}
          AND ${communityFilter}
        ORDER BY score DESC, p.created_at DESC
        LIMIT ${candidateLimit}
    `);

    const candidates = (result.rows as Array<any>).map((row) => ({
        ...withLinkPreview(row),
        createdAt: new Date(row.createdAt),
        favCount: Number(row.favCount) || 0,
        replyCount: Number(row.replyCount) || 0,
        rtCount: Number(row.rtCount) || 0,
        trashCount: Number(row.trashCount) || 0,
        pollVoteCount: Number(row.pollVoteCount) || 0,
    })) as PopularCandidateRow[];
    if (candidates.length === 0) {
        return [];
    }

    const scoredCandidates = opts.analytics ? candidates : await attachPostViewCounts(candidates);

    const behaviorMetrics = opts.analytics
        ? await getEntityBehaviorMetrics(
            opts.analytics,
            "post",
            scoredCandidates.map((candidate) => candidate.id),
            opts.window === "7d" ? 7 : 1
        )
        : new Map<string, EntityBehaviorMetrics>();

    const reranked = scoredCandidates
        .map((candidate) => {
            const metrics = behaviorMetrics.get(candidate.id) ?? {
                entityId: candidate.id,
                eventsTotal: 0,
                impressionCount: 0,
                openCount: 0,
                dwellCount: 0,
                dwellTotalMs: 0,
                replySubmitCount: 0,
                repostCount: 0,
                quoteCount: 0,
                likeCount: 0,
                trashCount: 0,
            };

            return {
                ...candidate,
                viewCount: Number(candidate.viewCount) || metrics.impressionCount || 0,
                score: Number(computePopularScore(candidate, metrics, opts.window).toFixed(4)),
            };
        })
        .sort((left, right) => right.score - left.score || right.createdAt.getTime() - left.createdAt.getTime());

    if (opts.analytics && cacheKey) {
        try {
            await opts.analytics.set(cacheKey, serializePopularCandidates(reranked), "EX", 90);
        } catch {
            // Ignore cache write failures.
        }
    }

    return hydrateViewerPopularState(reranked, opts.viewerId, clampedLimit);
}

export async function getHotKeywords(window: "1h" | "6h" | "24h" = "6h", limit = 10, viewerId?: string): Promise<HotKeyword[]> {
    return getScopedHotKeywords({ window, limit, viewerId });
}

export async function getCommunityHotKeywords(communityId: string, window: "1h" | "6h" | "24h" = "6h", limit = 10): Promise<HotKeyword[]> {
    return getScopedHotKeywords({ window, limit, communityId });
}

async function getScopedHotKeywords(opts: { window: "1h" | "6h" | "24h"; limit: number; communityId?: string; viewerId?: string }): Promise<HotKeyword[]> {
    const clampedLimit = Math.min(Math.max(opts.limit, 1), 20);
    const interval = opts.window === "24h"
        ? sql.raw(`INTERVAL '24 hours'`)
        : opts.window === "1h"
            ? sql.raw(`INTERVAL '1 hour'`)
            : sql.raw(`INTERVAL '6 hours'`);
    const recentInterval = opts.window === "24h"
        ? sql.raw(`INTERVAL '4 hours'`)
        : opts.window === "1h"
            ? sql.raw(`INTERVAL '15 minutes'`)
            : sql.raw(`INTERVAL '1 hour'`);
    const baselineInterval = recentInterval;

    const stopWords = keywordStopWords();
    const stopWordList = sql.join(stopWords.map((word) => sql`${word}`), sql`, `);

    const result = await db.execute<{ keyword: string; count: string }>(sql`
        WITH window_posts AS (
            SELECT p.user_id AS user_id, p.content, p.created_at
            FROM posts p
            LEFT JOIN post_communities pc ON pc.post_id = p.id
            LEFT JOIN communities c ON c.id = pc.community_id
            WHERE p.created_at >= NOW() - ${interval}
              AND COALESCE(BTRIM(p.content), '') <> ''
              AND ${opts.communityId
            ? sql`pc.community_id = ${opts.communityId}`
            : opts.viewerId
                ? sql`(
                    pc.community_id IS NULL
                    OR c.is_private = false
                    OR EXISTS (
                        SELECT 1
                        FROM community_members cm
                        WHERE cm.community_id = pc.community_id
                          AND cm.user_id = ${opts.viewerId}
                    )
                )`
                : sql`pc.community_id IS NULL OR c.is_private = false`}
        ),
        active_users AS (
            SELECT COUNT(DISTINCT user_id)::int AS active_user_count
            FROM window_posts
        ),
        filtered_tokens AS (
            SELECT
                wp.user_id,
                wp.created_at,
                lower(token_match[2]) AS keyword
            FROM window_posts wp
            CROSS JOIN LATERAL regexp_matches(
                wp.content,
                '(^|[^@#[:alnum:]çğıöşü])((#[[:alpha:]çğıöşü][[:alnum:]_çğıöşü]{2,30})|([[:alpha:]çğıöşü]{3,24}))($|[^[:alnum:]_çğıöşü])',
                'g'
            ) AS token_match
        ),
        scored_source_tokens AS (
            SELECT user_id, created_at, keyword
            FROM filtered_tokens
            WHERE keyword NOT IN (${stopWordList})
              AND keyword !~ '^(https?://|www\.)'
        ),
        per_user_keyword AS (
            SELECT
                keyword,
                user_id,
                COUNT(*)::int AS user_token_count,
                SUM(CASE WHEN created_at >= NOW() - ${recentInterval} THEN 1 ELSE 0 END)::int AS recent_token_count,
                SUM(
                    CASE
                        WHEN created_at < NOW() - ${recentInterval}
                         AND created_at >= NOW() - ${recentInterval} - ${baselineInterval}
                        THEN 1
                        ELSE 0
                    END
                )::int AS baseline_token_count
            FROM scored_source_tokens
            GROUP BY keyword, user_id
        ),
        keyword_aggregates AS (
            SELECT
                keyword,
                COUNT(DISTINCT user_id)::int AS unique_user_count,
                SUM(user_token_count)::int AS raw_count,
                SUM(LEAST(user_token_count, 2))::int AS weighted_count,
                SUM(LEAST(recent_token_count, 2))::int AS recent_count,
                SUM(LEAST(baseline_token_count, 2))::int AS baseline_count,
                COUNT(DISTINCT CASE WHEN recent_token_count > 0 THEN user_id END)::int AS recent_unique_user_count,
                COUNT(DISTINCT CASE WHEN baseline_token_count > 0 THEN user_id END)::int AS baseline_unique_user_count
            FROM per_user_keyword
            GROUP BY keyword
        ),
        recent_active_users AS (
            SELECT COUNT(DISTINCT user_id)::int AS active_recent_user_count
            FROM window_posts
            WHERE created_at >= NOW() - ${recentInterval}
        ),
        baseline_active_users AS (
            SELECT COUNT(DISTINCT user_id)::int AS active_baseline_user_count
            FROM window_posts
            WHERE created_at < NOW() - ${recentInterval}
              AND created_at >= NOW() - ${recentInterval} - ${baselineInterval}
        ),
        scored_keywords AS (
            SELECT
                ka.keyword,
                ka.raw_count,
                ka.recent_unique_user_count,
                (
                    0.65 * COALESCE((ka.recent_unique_user_count::float / NULLIF(rau.active_recent_user_count, 0)), 0) +
                    0.25 * COALESCE((ka.recent_count::float / NULLIF(ka.weighted_count, 0)), 0) +
                    0.10 * COALESCE(
                        LEAST(
                            3.0,
                            (ka.recent_unique_user_count::float / NULLIF(rau.active_recent_user_count, 0)) /
                            NULLIF((ka.baseline_unique_user_count::float / NULLIF(bau.active_baseline_user_count, 0)), 0)
                        ),
                        0
                    )
                ) AS score
            FROM keyword_aggregates ka
            CROSS JOIN active_users au
            CROSS JOIN recent_active_users rau
            CROSS JOIN baseline_active_users bau
            WHERE ka.raw_count >= 2
              AND rau.active_recent_user_count >= 1
              AND ka.recent_unique_user_count >= GREATEST(
                  1,
                  CEIL(rau.active_recent_user_count * 0.12)::int
              )
              AND ka.unique_user_count >= GREATEST(1, CEIL(au.active_user_count * 0.08)::int)
        ),
        fallback_keywords AS (
            SELECT
                ka.keyword,
                ka.raw_count,
                ka.recent_unique_user_count,
                (
                    (ka.raw_count * 1.0) +
                    (ka.recent_count * 1.4) +
                    (ka.unique_user_count * 1.8)
                ) AS score
            FROM keyword_aggregates ka
            WHERE ka.raw_count >= 2
              AND ka.unique_user_count >= 1
        )
        SELECT keyword, raw_count::text AS count
        FROM (
            SELECT keyword, raw_count, recent_unique_user_count, score
            FROM scored_keywords
            UNION ALL
            SELECT keyword, raw_count, recent_unique_user_count, score
            FROM fallback_keywords
            WHERE NOT EXISTS (SELECT 1 FROM scored_keywords)
        ) ranked_keywords
        ORDER BY score DESC, recent_unique_user_count DESC, raw_count DESC, keyword ASC
        LIMIT ${clampedLimit}
    `);

    return result.rows.map((row) => ({ keyword: row.keyword, count: parseInt(row.count, 10) }));
}

export interface KeywordFeedOptions {
    keyword: string;
    cursor?: string;
    viewerId?: string;
    limit?: number;
}

export async function getKeywordFeed(opts: KeywordFeedOptions): Promise<FeedPost[]> {
    const keyword = opts.keyword.trim();
    if (keyword.length < 2) return [];

    const limit = Math.min(opts.limit ?? 30, 100);
    const parsedCursor = parseCursor(opts.cursor);

    const escapedKeywordPattern = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keywordRegex = keyword.startsWith("#")
        ? `(^|[^[:alnum:]_])${escapedKeywordPattern}($|[^[:alnum:]_])`
        : `(^|[^[:alpha:]çğıöşü])${escapedKeywordPattern}($|[^[:alpha:]çğıöşü])`;

    const whereClauses = [
        and(
            or(
                sql`${posts.type} IN ('rt', 'quote')`,
                isNull(posts.parentId)
            )!,
            sql`${posts.content} ~* ${keywordRegex}`
        )!,
    ];

    if (parsedCursor) {
        whereClauses.push(
            or(
                lt(posts.createdAt, parsedCursor.createdAt),
                and(eq(posts.createdAt, parsedCursor.createdAt), lt(posts.id, parsedCursor.id))
            )!
        );
    }

    const hasFavSelect = opts.viewerId
        ? sql<boolean>`EXISTS(
            SELECT 1 FROM interactions i
            WHERE i.user_id = ${opts.viewerId}
              AND i.post_id = ${posts.id}
              AND i.type = 'FAV'
        )`
        : sql<boolean>`false`;

    const hasTrashSelect = opts.viewerId
        ? sql<boolean>`EXISTS(
            SELECT 1 FROM interactions i
            WHERE i.user_id = ${opts.viewerId}
              AND i.post_id = ${posts.id}
              AND i.type = 'TRASH'
        )`
        : sql<boolean>`false`;

    const postsFound = await db
        .select({
            id: posts.id,
            userId: posts.userId,
            content: posts.content,
            mediaUrl: posts.mediaUrl,
            mediaMimeType: posts.mediaMimeType,
            linkPreviewUrl: posts.linkPreviewUrl,
            linkPreviewTitle: posts.linkPreviewTitle,
            linkPreviewDescription: posts.linkPreviewDescription,
            linkPreviewImageUrl: posts.linkPreviewImageUrl,
            linkPreviewSiteName: posts.linkPreviewSiteName,
            parentId: posts.parentId,
            type: posts.type,
            favCount: posts.favCount,
            trashCount: posts.trashCount,
            replyCount: posts.replyCount,
            rtCount: posts.rtCount,
            createdAt: posts.createdAt,
            authorUsername: users.username,
            authorProfilePic: users.profilePic,
            authorRole: users.role,
            communityId: communities.id,
            communitySlug: communities.slug,
            communityName: communities.name,
            hasFav: hasFavSelect,
            hasTrash: hasTrashSelect,
        })
        .from(posts)
        .innerJoin(users, eq(posts.userId, users.id))
        .leftJoin(postCommunities, eq(postCommunities.postId, posts.id))
        .leftJoin(communities, eq(postCommunities.communityId, communities.id))
        .where(and(buildVisiblePostFilter(opts.viewerId), ...whereClauses))
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(limit);

    const postsWithViews = await attachPostViewCounts(postsFound.map((row) => withLinkPreview(row)));
    return enrichFeedWithPolls(postsWithViews as FeedPost[], opts.viewerId);
}

export async function canViewPrivateCommunity(communityId: string, userId?: string): Promise<boolean> {
    if (!userId) return false;

    const membership = await db
        .select({ communityId: communityMembers.communityId })
        .from(communityMembers)
        .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)))
        .limit(1);

    return membership.length > 0;
}
