import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { interactions } from "../db/schema";
import { enrichFeedWithPolls, type FeedPost } from "./decay";
import type { PendingPreviewFields } from "./linkPreview";
import { withLinkPreview } from "./linkPreview";

const FOR_YOU_POST_WINDOW_DAYS = 14;
const AUTHOR_SIGNAL_WINDOW_DAYS = 90;
const FOR_YOU_MIN_POOL = 80;
const FOR_YOU_MAX_POOL = 250;
const FOR_YOU_POOL_MULTIPLIER = 5;
const MAX_FOR_YOU_REFRESH_DEPTH = 4;
const CHAOS_SLOT_POSITIONS = [2, 7, 12];
const REPLY_SLOT_PLANS = [
    [3, 8, 13],
    [2, 6, 10, 15],
    [1, 4, 8, 12, 17],
    [1, 3, 7, 11, 16],
    [0, 2, 5, 9, 14, 19],
] as const;
const AUTHOR_COOLDOWN_WINDOW = 4;
const THREAD_COOLDOWN_WINDOW = 5;
const AUTHOR_EXPOSURE_PENALTY = 0.9;
const AUTHOR_EXPOSURE_EXPONENT = 1.35;
const FOLLOW_AFFINITY_WEIGHT = 10.0;
const REPLY_SCORE_MULTIPLIER_BASE = 0.92;
const REPLY_SCORE_MULTIPLIER_STEP = 0.03;
const REPLY_SURFACE_BONUS_BASE = 3.5;
const REPLY_SURFACE_BONUS_STEP = 1.5;
const EXPLORATION_BLEND_BY_DEPTH = [0.08, 0.2, 0.34, 0.5, 0.64] as const;
const AUTHOR_PREFIX_LIMITS = [
    { untilPosition: 10, maxPerAuthor: 1 },
    { untilPosition: 20, maxPerAuthor: 2 },
    { untilPosition: 35, maxPerAuthor: 3 },
    { untilPosition: 50, maxPerAuthor: 4 },
];
const THREAD_PREFIX_LIMITS = [
    { untilPosition: 12, maxPerThread: 1 },
    { untilPosition: 30, maxPerThread: 2 },
    { untilPosition: 50, maxPerThread: 3 },
];

const WEIGHT_AFFINITY = 1.0;
const WEIGHT_VIRAL = 0.8;
const WEIGHT_CHAOS = 1.5;
const WEIGHT_DECAY = 2.0;
const FOR_YOU_POST_WINDOW = sql.raw(`INTERVAL '${FOR_YOU_POST_WINDOW_DAYS} days'`);
const AUTHOR_SIGNAL_WINDOW = sql.raw(`INTERVAL '${AUTHOR_SIGNAL_WINDOW_DAYS} days'`);
const FRESH_CONTEXT_WINDOW = sql.raw(`INTERVAL '30 days'`);
const RECENT_EXPOSURE_WINDOW = sql.raw(`INTERVAL '7 days'`);
const RECENT_FOLLOW_WINDOW = sql.raw(`INTERVAL '21 days'`);

interface ForYouCandidateRow extends Record<string, unknown>, FeedPost, PendingPreviewFields {
    communityIsPrivate: boolean | null;
    affinityScore: number;
    viralScore: number;
    chaosScore: number;
    score: number;
    selectionScore: number;
    threadRootId: string;
    replyMultiplier: number;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function getReplySlotPositions(refreshDepth: number) {
    return REPLY_SLOT_PLANS[clamp(refreshDepth, 0, MAX_FOR_YOU_REFRESH_DEPTH)] ?? REPLY_SLOT_PLANS[0];
}

function getReplyScoreMultiplier(refreshDepth: number) {
    return REPLY_SCORE_MULTIPLIER_BASE + (clamp(refreshDepth, 0, MAX_FOR_YOU_REFRESH_DEPTH) * REPLY_SCORE_MULTIPLIER_STEP);
}

function getReplySurfaceBonus(refreshDepth: number) {
    return REPLY_SURFACE_BONUS_BASE + (clamp(refreshDepth, 0, MAX_FOR_YOU_REFRESH_DEPTH) * REPLY_SURFACE_BONUS_STEP);
}

function getExplorationBlend(refreshDepth: number) {
    return EXPLORATION_BLEND_BY_DEPTH[clamp(refreshDepth, 0, MAX_FOR_YOU_REFRESH_DEPTH)] ?? EXPLORATION_BLEND_BY_DEPTH[0];
}

function buildForYouSequence(candidates: ForYouCandidateRow[], refreshDepth: number): ForYouCandidateRow[] {
    if (candidates.length === 0) {
        return [];
    }

    const replySlotPositions = getReplySlotPositions(refreshDepth);
    const selectedReplies: ForYouCandidateRow[] = [];
    const usedInjectedAuthors = new Set<string>();
    const usedInjectedThreads = new Set<string>();
    const replyCandidates = candidates
        .filter((candidate) => Boolean(candidate.parentId))
        .sort((left, right) => {
            return right.selectionScore - left.selectionScore
                || right.score - left.score
                || right.createdAt.getTime() - left.createdAt.getTime();
        });

    for (const candidate of replyCandidates) {
        if (usedInjectedAuthors.has(candidate.userId) || usedInjectedThreads.has(candidate.threadRootId)) {
            continue;
        }
        selectedReplies.push(candidate);
        usedInjectedAuthors.add(candidate.userId);
        usedInjectedThreads.add(candidate.threadRootId);
        if (selectedReplies.length >= replySlotPositions.length) {
            break;
        }
    }

    const replyIds = new Set(selectedReplies.map((candidate) => candidate.id));
    const chaosCandidates = candidates
        .filter((candidate) => candidate.chaosScore > 0 && !replyIds.has(candidate.id))
        .sort((left, right) => right.chaosScore - left.chaosScore || right.score - left.score);
    const selectedChaos: ForYouCandidateRow[] = [];
    for (const candidate of chaosCandidates) {
        if (usedInjectedAuthors.has(candidate.userId) || usedInjectedThreads.has(candidate.threadRootId)) {
            continue;
        }
        selectedChaos.push(candidate);
        usedInjectedAuthors.add(candidate.userId);
        usedInjectedThreads.add(candidate.threadRootId);
        if (selectedChaos.length >= CHAOS_SLOT_POSITIONS.length) {
            break;
        }
    }
    const injectedIds = new Set([
        ...selectedReplies.map((candidate) => candidate.id),
        ...selectedChaos.map((candidate) => candidate.id),
    ]);
    const ranked = candidates
        .filter((candidate) => !injectedIds.has(candidate.id))
        .sort((left, right) => right.score - left.score || right.createdAt.getTime() - left.createdAt.getTime());
    const diversifiedRanked = buildDiversifiedAuthorSequence(ranked);

    const injectedEntries = [
        ...selectedChaos.map((candidate, index) => ({
            candidate,
            position: CHAOS_SLOT_POSITIONS[index] ?? diversifiedRanked.length,
        })),
        ...selectedReplies.map((candidate, index) => ({
            candidate,
            position: replySlotPositions[index] ?? diversifiedRanked.length,
        })),
    ].sort((left, right) => left.position - right.position);

    injectedEntries.forEach(({ candidate, position }) => {
        const insertAt = Math.min(position, diversifiedRanked.length);
        diversifiedRanked.splice(insertAt, 0, candidate);
    });

    return diversifiedRanked;
}

function getAuthorPrefixLimit(position: number) {
    for (const rule of AUTHOR_PREFIX_LIMITS) {
        if (position <= rule.untilPosition) {
            return rule.maxPerAuthor;
        }
    }

    return Number.POSITIVE_INFINITY;
}

function getThreadPrefixLimit(position: number) {
    for (const rule of THREAD_PREFIX_LIMITS) {
        if (position <= rule.untilPosition) {
            return rule.maxPerThread;
        }
    }

    return Number.POSITIVE_INFINITY;
}

function adjustedAuthorScore(candidate: ForYouCandidateRow, currentAuthorCount: number) {
    return candidate.score / Math.pow(1 + currentAuthorCount * AUTHOR_EXPOSURE_PENALTY, AUTHOR_EXPOSURE_EXPONENT);
}

function pickNextDiversifiedCandidate(
    remaining: ForYouCandidateRow[],
    selected: ForYouCandidateRow[],
    authorCounts: Map<string, number>,
    threadCounts: Map<string, number>
) {
    const position = selected.length + 1;
    const authorPrefixLimit = getAuthorPrefixLimit(position);
    const threadPrefixLimit = getThreadPrefixLimit(position);
    const recentAuthors = new Set(selected.slice(-AUTHOR_COOLDOWN_WINDOW).map((candidate) => candidate.userId));
    const recentThreads = new Set(selected.slice(-THREAD_COOLDOWN_WINDOW).map((candidate) => candidate.threadRootId));

    const noCooldownAndWithinCap = remaining.filter((candidate) => {
        const authorCount = authorCounts.get(candidate.userId) ?? 0;
        const threadCount = threadCounts.get(candidate.threadRootId) ?? 0;
        return !recentAuthors.has(candidate.userId)
            && !recentThreads.has(candidate.threadRootId)
            && authorCount < authorPrefixLimit
            && threadCount < threadPrefixLimit;
    });

    const noCooldown = remaining.filter((candidate) => {
        return !recentAuthors.has(candidate.userId) && !recentThreads.has(candidate.threadRootId);
    });

    const withinCaps = remaining.filter((candidate) => {
        const authorCount = authorCounts.get(candidate.userId) ?? 0;
        const threadCount = threadCounts.get(candidate.threadRootId) ?? 0;
        return authorCount < authorPrefixLimit && threadCount < threadPrefixLimit;
    });

    const withinAuthorCap = remaining.filter((candidate) => {
        const authorCount = authorCounts.get(candidate.userId) ?? 0;
        return authorCount < authorPrefixLimit;
    });

    const withinThreadCap = remaining.filter((candidate) => {
        const threadCount = threadCounts.get(candidate.threadRootId) ?? 0;
        return threadCount < threadPrefixLimit;
    });

    const candidatePool = noCooldownAndWithinCap.length > 0
        ? noCooldownAndWithinCap
        : noCooldown.length > 0
            ? noCooldown
            : withinCaps.length > 0
                ? withinCaps
                : withinAuthorCap.length > 0
                    ? withinAuthorCap
                    : withinThreadCap.length > 0
                        ? withinThreadCap
                        : remaining;

    let bestCandidate: ForYouCandidateRow | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidatePool) {
        const count = authorCounts.get(candidate.userId) ?? 0;
        const score = adjustedAuthorScore(candidate, count);
        if (
            score > bestScore ||
            (score === bestScore && candidate.score > (bestCandidate?.score ?? Number.NEGATIVE_INFINITY)) ||
            (score === bestScore && candidate.score === (bestCandidate?.score ?? Number.NEGATIVE_INFINITY) && candidate.createdAt > (bestCandidate?.createdAt ?? new Date(0)))
        ) {
            bestCandidate = candidate;
            bestScore = score;
        }
    }

    return bestCandidate;
}

function buildDiversifiedAuthorSequence(candidates: ForYouCandidateRow[]) {
    const remaining = [...candidates];
    const selected: ForYouCandidateRow[] = [];
    const authorCounts = new Map<string, number>();
    const threadCounts = new Map<string, number>();

    while (remaining.length > 0) {
        const nextCandidate = pickNextDiversifiedCandidate(remaining, selected, authorCounts, threadCounts);
        if (!nextCandidate) {
            break;
        }

        const currentAuthorCount = authorCounts.get(nextCandidate.userId) ?? 0;
        const currentThreadCount = threadCounts.get(nextCandidate.threadRootId) ?? 0;
        selected.push(nextCandidate);
        authorCounts.set(nextCandidate.userId, currentAuthorCount + 1);
        threadCounts.set(nextCandidate.threadRootId, currentThreadCount + 1);

        const nextIndex = remaining.findIndex((candidate) => candidate.id === nextCandidate.id);
        if (nextIndex >= 0) {
            remaining.splice(nextIndex, 1);
        }
    }

    return selected;
}

async function hydrateViewerInteractions(posts: ForYouCandidateRow[], viewerId: string): Promise<FeedPost[]> {
    if (posts.length === 0) {
        return [];
    }

    const interactionRows = await db
        .select({
            postId: interactions.postId,
            type: interactions.type,
        })
        .from(interactions)
        .where(and(eq(interactions.userId, viewerId), inArray(interactions.postId, posts.map((post) => post.id))));

    const stateByPostId = new Map<string, { hasFav: boolean; hasTrash: boolean }>();
    for (const row of interactionRows) {
        const current = stateByPostId.get(row.postId) ?? { hasFav: false, hasTrash: false };
        if (row.type === "FAV") current.hasFav = true;
        if (row.type === "TRASH") current.hasTrash = true;
        stateByPostId.set(row.postId, current);
    }

    return enrichFeedWithPolls(
        posts.map((post) => {
            const state = stateByPostId.get(post.id);
            return {
                ...post,
                hasFav: state?.hasFav ?? false,
                hasTrash: state?.hasTrash ?? false,
            };
        }) as FeedPost[],
        viewerId
    );
}

export async function getForYouFeed(opts: { viewerId: string; limit?: number; offset?: number; refreshDepth?: number }) {
    const limit = clamp(opts.limit ?? 30, 1, 50);
    const offset = Math.max(opts.offset ?? 0, 0);
    const refreshDepth = clamp(opts.refreshDepth ?? 0, 0, MAX_FOR_YOU_REFRESH_DEPTH);
    const replySlotPositions = getReplySlotPositions(refreshDepth);
    const replyScoreMultiplier = getReplyScoreMultiplier(refreshDepth);
    const replySurfaceBonus = getReplySurfaceBonus(refreshDepth);
    const explorationBlend = getExplorationBlend(refreshDepth);
    const poolLimit = clamp(
        (offset + limit + CHAOS_SLOT_POSITIONS.length + replySlotPositions.length + 2) * FOR_YOU_POOL_MULTIPLIER,
        FOR_YOU_MIN_POOL,
        FOR_YOU_MAX_POOL
    );

    const result = await db.execute<ForYouCandidateRow>(sql`
        WITH candidate_posts AS (
            SELECT DISTINCT ON (p.id)
                p.id,
                p.user_id,
                p.content,
                p.media_url,
                p.media_mime_type,
                p.link_preview_url,
                p.link_preview_title,
                p.link_preview_description,
                p.link_preview_image_url,
                p.link_preview_site_name,
                p.parent_id,
                COALESCE(p.parent_id, p.id) AS thread_root_id,
                p.type,
                p.fav_count,
                p.trash_count,
                p.reply_count,
                p.rt_count,
                p.created_at,
                u.username AS author_username,
                u.profile_pic AS author_profile_pic,
                u.role AS author_role,
                c.id AS community_id,
                c.slug AS community_slug,
                c.name AS community_name,
                c.is_private AS community_is_private
            FROM posts p
            INNER JOIN users u ON u.id = p.user_id
            LEFT JOIN post_communities pc ON pc.post_id = p.id
            LEFT JOIN communities c ON c.id = pc.community_id
            WHERE p.type = 'post'
              AND p.user_id <> ${opts.viewerId}
              AND p.created_at >= NOW() - ${FOR_YOU_POST_WINDOW}
              AND NOT EXISTS (
                  SELECT 1
                  FROM blocks b
                  WHERE (b.blocker_id = ${opts.viewerId} AND b.blocked_id = p.user_id)
                     OR (b.blocker_id = p.user_id AND b.blocked_id = ${opts.viewerId})
              )
              AND (
                  pc.community_id IS NULL
                  OR c.is_private = false
                  OR EXISTS (
                      SELECT 1
                      FROM community_members cm
                      WHERE cm.community_id = pc.community_id
                        AND cm.user_id = ${opts.viewerId}
                  )
              )
            ORDER BY p.id, c.is_private ASC NULLS FIRST, c.id ASC NULLS FIRST
        ),
        candidate_authors AS (
            SELECT DISTINCT user_id AS author_id, author_username
            FROM candidate_posts
        ),
        candidate_communities AS (
            SELECT DISTINCT community_id, community_slug
            FROM candidate_posts
            WHERE community_id IS NOT NULL
              AND community_slug IS NOT NULL
        ),
        author_dwell AS (
            SELECT
                viewed_posts.user_id AS author_id,
                SUM(COALESCE(events.dwell_ms, 0))::double precision / 1000.0 AS dwell_seconds
            FROM behavioral_analytics_events events
            INNER JOIN posts viewed_posts ON viewed_posts.id::text = events.entity_id
            INNER JOIN candidate_authors ON candidate_authors.author_id = viewed_posts.user_id
            WHERE events.user_id = ${opts.viewerId}
              AND events.event_type = 'post_dwell'
              AND events.entity_type = 'post'
              AND events.occurred_at >= NOW() - ${AUTHOR_SIGNAL_WINDOW}
            GROUP BY viewed_posts.user_id
        ),
        author_opens AS (
            SELECT
                viewed_posts.user_id AS author_id,
                COUNT(*)::int AS open_count
            FROM behavioral_analytics_events events
            INNER JOIN posts viewed_posts ON viewed_posts.id::text = events.entity_id
            INNER JOIN candidate_authors ON candidate_authors.author_id = viewed_posts.user_id
            WHERE events.user_id = ${opts.viewerId}
              AND events.event_type = 'post_open'
              AND events.entity_type = 'post'
              AND events.occurred_at >= NOW() - ${AUTHOR_SIGNAL_WINDOW}
            GROUP BY viewed_posts.user_id
        ),
        author_replies AS (
            SELECT
                parent_posts.user_id AS author_id,
                COUNT(*)::int AS reply_count
            FROM posts reply_posts
            INNER JOIN posts parent_posts ON parent_posts.id = reply_posts.parent_id
            INNER JOIN candidate_authors ON candidate_authors.author_id = parent_posts.user_id
            WHERE reply_posts.user_id = ${opts.viewerId}
              AND reply_posts.created_at >= NOW() - ${AUTHOR_SIGNAL_WINDOW}
            GROUP BY parent_posts.user_id
        ),
        following_authors AS (
            SELECT following_id AS author_id, 1 AS is_following
            FROM follows
            INNER JOIN candidate_authors ON candidate_authors.author_id = follows.following_id
            WHERE follower_id = ${opts.viewerId}
        ),
        recent_viewer_follows AS (
            SELECT following_id AS author_id, 1 AS recently_followed
            FROM follows
            INNER JOIN candidate_authors ON candidate_authors.author_id = follows.following_id
            WHERE follower_id = ${opts.viewerId}
              AND created_at >= NOW() - ${RECENT_FOLLOW_WINDOW}
        ),
        author_profile_views AS (
            SELECT
                candidate_authors.author_id,
                COUNT(*)::int AS profile_view_count
            FROM behavioral_analytics_events events
            INNER JOIN candidate_authors ON candidate_authors.author_username = events.entity_id
            WHERE events.user_id = ${opts.viewerId}
              AND events.event_type = 'profile_view'
              AND events.entity_type = 'user'
              AND events.occurred_at >= NOW() - ${FRESH_CONTEXT_WINDOW}
            GROUP BY candidate_authors.author_id
        ),
        community_interest AS (
            SELECT
                candidate_communities.community_id,
                COUNT(*)::int AS community_view_count
            FROM behavioral_analytics_events events
            INNER JOIN candidate_communities ON candidate_communities.community_slug = events.entity_id
            WHERE events.user_id = ${opts.viewerId}
              AND events.event_type = 'community_view'
              AND events.entity_type = 'community'
              AND events.occurred_at >= NOW() - ${FRESH_CONTEXT_WINDOW}
            GROUP BY candidate_communities.community_id
        ),
        viewer_community_memberships AS (
            SELECT
                community_members.community_id,
                1 AS is_member
            FROM community_members
            INNER JOIN candidate_communities ON candidate_communities.community_id = community_members.community_id
            WHERE community_members.user_id = ${opts.viewerId}
        ),
        viewer_post_feedback AS (
            SELECT
                candidate.id AS post_id,
                candidate.user_id AS author_id,
                candidate.thread_root_id,
                COUNT(*) FILTER (WHERE events.event_type = 'post_impression')::int AS impression_count,
                COUNT(*) FILTER (WHERE events.event_type = 'post_open')::int AS open_count,
                SUM(CASE WHEN events.event_type = 'post_dwell' THEN COALESCE(events.dwell_ms, 0) ELSE 0 END)::double precision / 1000.0 AS dwell_seconds
            FROM candidate_posts candidate
            INNER JOIN behavioral_analytics_events events ON events.entity_id = candidate.id::text
            WHERE events.user_id = ${opts.viewerId}
              AND events.entity_type = 'post'
              AND events.event_type IN ('post_impression', 'post_open', 'post_dwell')
              AND events.occurred_at >= NOW() - ${RECENT_EXPOSURE_WINDOW}
            GROUP BY candidate.id, candidate.user_id, candidate.thread_root_id
        ),
        author_recent_exposure AS (
            SELECT
                author_id,
                SUM(impression_count)::int AS impression_count,
                SUM(open_count)::int AS open_count,
                SUM(dwell_seconds)::double precision AS dwell_seconds
            FROM viewer_post_feedback
            GROUP BY author_id
        ),
        thread_recent_exposure AS (
            SELECT
                thread_root_id,
                SUM(impression_count)::int AS impression_count,
                SUM(open_count)::int AS open_count,
                SUM(dwell_seconds)::double precision AS dwell_seconds
            FROM viewer_post_feedback
            GROUP BY thread_root_id
        ),
        post_behavior AS (
            SELECT
                events.entity_id AS post_id_text,
                SUM(CASE WHEN events.event_type = 'post_dwell' THEN COALESCE(events.dwell_ms, 0) ELSE 0 END)::double precision / 1000.0 AS total_dwell_seconds,
                COUNT(*) FILTER (WHERE events.event_type = 'post_impression')::int AS impression_count,
                COUNT(*) FILTER (WHERE events.event_type = 'post_open')::int AS open_count,
                COUNT(*) FILTER (WHERE events.event_type = 'post_reply_submit')::int AS reply_submit_count,
                COUNT(*) FILTER (WHERE events.event_type = 'post_share')::int AS share_count,
                COUNT(*) FILTER (WHERE events.event_type = 'post_repost')::int AS repost_count
            FROM behavioral_analytics_events events
            INNER JOIN candidate_posts candidate ON candidate.id::text = events.entity_id
            WHERE events.entity_type = 'post'
              AND events.event_type IN ('post_dwell', 'post_impression', 'post_open', 'post_reply_submit', 'post_share', 'post_repost')
            GROUP BY events.entity_id
        ),
        scored_candidates AS (
            SELECT
                candidate.*,
                COALESCE(author_dwell.dwell_seconds, 0)::double precision AS author_dwell_seconds,
                COALESCE(author_opens.open_count, 0)::int AS author_open_count,
                COALESCE(author_replies.reply_count, 0)::int AS author_reply_count,
                COALESCE(following_authors.is_following, 0)::int AS is_following,
                COALESCE(recent_viewer_follows.recently_followed, 0)::int AS recently_followed,
                COALESCE(author_profile_views.profile_view_count, 0)::int AS author_profile_view_count,
                COALESCE(community_interest.community_view_count, 0)::int AS community_view_count,
                COALESCE(viewer_community_memberships.is_member, 0)::int AS viewer_is_community_member,
                COALESCE(author_recent_exposure.impression_count, 0)::int AS recent_author_impression_count,
                COALESCE(author_recent_exposure.open_count, 0)::int AS recent_author_open_count,
                COALESCE(author_recent_exposure.dwell_seconds, 0)::double precision AS recent_author_dwell_seconds,
                COALESCE(thread_recent_exposure.impression_count, 0)::int AS recent_thread_impression_count,
                COALESCE(thread_recent_exposure.open_count, 0)::int AS recent_thread_open_count,
                COALESCE(thread_recent_exposure.dwell_seconds, 0)::double precision AS recent_thread_dwell_seconds,
                COALESCE(viewer_post_feedback.impression_count, 0)::int AS recent_post_impression_count,
                COALESCE(viewer_post_feedback.open_count, 0)::int AS recent_post_open_count,
                COALESCE(post_behavior.total_dwell_seconds, 0)::double precision AS total_post_dwell_seconds,
                COALESCE(post_behavior.impression_count, 0)::int AS post_impression_count,
                COALESCE(post_behavior.open_count, 0)::int AS post_open_count,
                COALESCE(post_behavior.reply_submit_count, 0)::int AS post_reply_submit_count,
                COALESCE(post_behavior.share_count, 0)::int AS post_share_count,
                COALESCE(post_behavior.repost_count, 0)::int AS post_repost_count,
                (
                    8.0 * LN(COALESCE(author_dwell.dwell_seconds, 0) + 1.0) +
                    12.0 * LN(COALESCE(author_opens.open_count, 0) + 1.0) +
                    10.0 * LN(COALESCE(author_profile_views.profile_view_count, 0) + 1.0) +
                    6.0 * LN(COALESCE(community_interest.community_view_count, 0) + 1.0) +
                    8.0 * COALESCE(viewer_community_memberships.is_member, 0) +
                    42.0 * COALESCE(author_replies.reply_count, 0) +
                    18.0 * COALESCE(recent_viewer_follows.recently_followed, 0) +
                    ${FOLLOW_AFFINITY_WEIGHT} * COALESCE(following_authors.is_following, 0)
                )::double precision AS affinity_score,
                (
                    2.0 * candidate.fav_count +
                    10.0 * candidate.reply_count +
                    5.0 * (COALESCE(post_behavior.total_dwell_seconds, 0) / (COALESCE(post_behavior.impression_count, 0) + 1.0)) -
                    2.0 * candidate.trash_count +
                    (
                        (
                            18.0 * (COALESCE(post_behavior.open_count, 0)::double precision / (COALESCE(post_behavior.impression_count, 0) + 5.0)) +
                            20.0 * (COALESCE(post_behavior.reply_submit_count, 0)::double precision / (COALESCE(post_behavior.impression_count, 0) + 5.0)) +
                            8.0 * (COALESCE(post_behavior.share_count, 0)::double precision / (COALESCE(post_behavior.impression_count, 0) + 5.0)) +
                            6.0 * (COALESCE(post_behavior.repost_count, 0)::double precision / (COALESCE(post_behavior.impression_count, 0) + 5.0)) -
                            14.0 * (candidate.trash_count::double precision / (COALESCE(post_behavior.impression_count, 0) + 5.0))
                        ) * LN(COALESCE(post_behavior.impression_count, 0) + 2.0)
                    )
                )::double precision AS viral_score,
                (
                    18.0 * LN(COALESCE(viewer_post_feedback.impression_count, 0) + 1.0) +
                    6.0 * LN(GREATEST(COALESCE(author_recent_exposure.impression_count, 0) - COALESCE(author_recent_exposure.open_count, 0), 0) + 1.0) +
                    10.0 * LN(GREATEST(COALESCE(thread_recent_exposure.impression_count, 0) - COALESCE(thread_recent_exposure.open_count, 0), 0) + 1.0) +
                    CASE
                        WHEN COALESCE(thread_recent_exposure.impression_count, 0) > 0
                         AND COALESCE(thread_recent_exposure.open_count, 0) = 0
                         AND COALESCE(thread_recent_exposure.dwell_seconds, 0) < 3.0
                        THEN 18.0
                        ELSE 0.0
                    END +
                    CASE
                        WHEN COALESCE(author_recent_exposure.impression_count, 0) >= 3
                         AND COALESCE(author_recent_exposure.open_count, 0) = 0
                         AND COALESCE(author_recent_exposure.dwell_seconds, 0) < 8.0
                        THEN 14.0
                        ELSE 0.0
                    END
                )::double precision AS fatigue_penalty,
                CASE
                    WHEN COALESCE(following_authors.is_following, 0) = 0
                     AND COALESCE(author_dwell.dwell_seconds, 0) = 0
                     AND COALESCE(author_replies.reply_count, 0) = 0
                     AND candidate.parent_id IS NULL
                    THEN (
                        15.0 * candidate.trash_count
                    ) * (
                        COALESCE(post_behavior.total_dwell_seconds, 0) / (COALESCE(post_behavior.impression_count, 0) + 1.0)
                    )
                    ELSE 0.0
                END AS chaos_score,
                CASE
                    WHEN candidate.parent_id IS NULL THEN 1.0
                    ELSE ${replyScoreMultiplier}
                END::double precision AS reply_multiplier,
                (EXTRACT(EPOCH FROM (NOW() - candidate.created_at)) / 3600.0)::double precision AS age_hours
            FROM candidate_posts candidate
            LEFT JOIN author_dwell ON author_dwell.author_id = candidate.user_id
            LEFT JOIN author_opens ON author_opens.author_id = candidate.user_id
            LEFT JOIN author_replies ON author_replies.author_id = candidate.user_id
            LEFT JOIN following_authors ON following_authors.author_id = candidate.user_id
            LEFT JOIN recent_viewer_follows ON recent_viewer_follows.author_id = candidate.user_id
            LEFT JOIN author_profile_views ON author_profile_views.author_id = candidate.user_id
            LEFT JOIN community_interest ON community_interest.community_id = candidate.community_id
            LEFT JOIN viewer_community_memberships ON viewer_community_memberships.community_id = candidate.community_id
            LEFT JOIN author_recent_exposure ON author_recent_exposure.author_id = candidate.user_id
            LEFT JOIN thread_recent_exposure ON thread_recent_exposure.thread_root_id = candidate.thread_root_id
            LEFT JOIN viewer_post_feedback ON viewer_post_feedback.post_id = candidate.id
            LEFT JOIN post_behavior ON post_behavior.post_id_text = candidate.id::text
        ),
        blended_candidates AS (
            SELECT
                scored_candidates.*,
                GREATEST(
                    (
                        (
                            ${WEIGHT_AFFINITY} * affinity_score +
                            ${WEIGHT_VIRAL} * viral_score -
                            ${WEIGHT_DECAY} * age_hours
                        ) * reply_multiplier
                    ) - fatigue_penalty,
                    (${WEIGHT_CHAOS} * chaos_score) - (fatigue_penalty * 0.55)
                )::double precision AS personalized_selection_score,
                (
                    (
                        0.95 * viral_score +
                        7.5 * LN(total_post_dwell_seconds + 1.0) +
                        5.0 * LN(post_open_count + 1.0) +
                        3.5 * LN(fav_count + 1.0) +
                        4.0 * LN(reply_count + 1.0) +
                        2.5 * LN(rt_count + 1.0) +
                        GREATEST(0.0, 28.0 - (age_hours * 2.2))
                    ) * reply_multiplier
                )::double precision AS exploration_score,
                CASE
                    WHEN parent_id IS NULL THEN 0.0
                    ELSE ${replySurfaceBonus}
                END::double precision AS reply_surface_bonus
            FROM scored_candidates
        )
        SELECT
            id,
            user_id AS "userId",
            content,
            media_url AS "mediaUrl",
            media_mime_type AS "mediaMimeType",
            link_preview_url AS "linkPreviewUrl",
            link_preview_title AS "linkPreviewTitle",
            link_preview_description AS "linkPreviewDescription",
            link_preview_image_url AS "linkPreviewImageUrl",
            link_preview_site_name AS "linkPreviewSiteName",
            parent_id AS "parentId",
            thread_root_id AS "threadRootId",
            type,
            fav_count AS "favCount",
            trash_count AS "trashCount",
            reply_count AS "replyCount",
            rt_count AS "rtCount",
            post_impression_count AS "viewCount",
            created_at AS "createdAt",
            author_username AS "authorUsername",
            author_profile_pic AS "authorProfilePic",
            author_role AS "authorRole",
            community_id AS "communityId",
            community_slug AS "communitySlug",
            community_name AS "communityName",
            community_is_private AS "communityIsPrivate",
            affinity_score AS "affinityScore",
            viral_score AS "viralScore",
            chaos_score AS "chaosScore",
            reply_multiplier AS "replyMultiplier",
            (
                ((1.0 - ${explorationBlend}) * personalized_selection_score) +
                (${explorationBlend} * exploration_score) +
                reply_surface_bonus
            )::double precision AS score,
            (
                ((1.0 - ${explorationBlend}) * personalized_selection_score) +
                (${explorationBlend} * exploration_score) +
                reply_surface_bonus
            )::double precision AS "selectionScore"
        FROM blended_candidates
        ORDER BY score DESC, created_at DESC
        LIMIT ${poolLimit}
    `);

    const candidates = (result.rows as ForYouCandidateRow[]).map((row) => {
        const enrichedRow = withLinkPreview(row);
        return {
            ...row,
            ...enrichedRow,
            createdAt: new Date(row.createdAt),
            favCount: Number(row.favCount) || 0,
            trashCount: Number(row.trashCount) || 0,
            replyCount: Number(row.replyCount) || 0,
            rtCount: Number(row.rtCount) || 0,
            viewCount: Number(row.viewCount) || 0,
            affinityScore: Number(row.affinityScore) || 0,
            viralScore: Number(row.viralScore) || 0,
            chaosScore: Number(row.chaosScore) || 0,
            score: Number(row.score) || 0,
            selectionScore: Number(row.selectionScore) || 0,
            replyMultiplier: Number(row.replyMultiplier) || 1,
            threadRootId: String(row.threadRootId ?? row.id),
        };
    });

    const rankedFeed = buildForYouSequence(candidates, refreshDepth);
    const page = rankedFeed.slice(offset, offset + limit);
    const nextOffset = rankedFeed.length > offset + limit ? String(offset + limit) : null;
    const hydratedPage = await hydrateViewerInteractions(page, opts.viewerId);

    return {
        posts: hydratedPage,
        nextOffset,
        totalCandidates: rankedFeed.length,
    };
}
