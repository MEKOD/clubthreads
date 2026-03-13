import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getLatestFeed, getNextCursor, getTopPostsWithAnalytics, enrichFeedWithPolls, getCommunityTopPostsWithAnalytics, getCommunityTrashPosts } from "../services/decay";
import { getForYouFeed } from "../services/forYouFeed";
import { db } from "../db";
import { communities, communityMembers, interactions, postCommunities, posts, users } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { AuthRequest } from "../plugins/auth";
import { getCommunityAccessBySlug } from "../services/communityAccess";
import { buildVisiblePostFilter } from "../services/communityVisibility";
import { withLinkPreview } from "../services/linkPreview";
import { buildViewerBlockFilter } from "../services/blocking";
import { attachPostViewCounts } from "../services/postViews";

const FeedQuerySchema = z.object({
    cursor: z.string().optional(),
    communityId: z.string().uuid().optional(),
    followFeed: z.enum(["true", "false"]).optional(),
    limit: z.string().optional(),
    mode: z.enum(["latest", "popular", "trash", "for_you"]).optional(),
    offset: z.string().optional(),
    refreshDepth: z.string().optional(),
});

const POPULAR_CACHE_TTL_SECONDS = 90;

export async function feedRoutes(app: FastifyInstance) {
    /**
     * GET /feed
     * ─────────────────────────────────────────────────────────────────────────
     * Global latest feed. Supports:
     *   ?cursor=<createdAt|id> — keyset pagination (infinite scroll)
     *   ?communityId=<uuid>    — filter to a community
     *   ?followFeed=true       — show only posts from followed users (requires auth)
     *   ?limit=30              — page size (max 100)
     *   ?mode=for_you          — personalized ranked feed (auth required)
     *   ?mode=popular          — legacy score-sorted popular feed (no cursor)
     */
    app.get("/feed", { preHandler: app.optionalAuth }, async (request, reply) => {
        const query = FeedQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.status(400).send({ error: "Invalid query parameters", details: query.error.flatten() });
        }

        const { cursor, communityId, followFeed, limit, mode, offset, refreshDepth } = query.data;

        const viewerId = (request as AuthRequest).userId;
        const requestedLimit = limit ? parseInt(limit, 10) : 30;
        const parsedLimit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(requestedLimit, 1), 50)
            : 30;
        const parsedOffset = offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0;
        const parsedRefreshDepth = refreshDepth ? Math.min(Math.max(parseInt(refreshDepth, 10) || 0, 0), 4) : 0;

        // ── For You mode ────────────────────────────────────────────────
        if (mode === "for_you") {
            if (!viewerId) {
                return reply.status(401).send({ error: "Authentication required for For You feed" });
            }

            try {
                const result = await getForYouFeed({
                    viewerId,
                    limit: parsedLimit,
                    offset: parsedOffset,
                    refreshDepth: parsedRefreshDepth,
                });

                return reply.send({
                    data: result.posts,
                    nextCursor: result.nextOffset,
                    count: result.posts.length,
                    mode: "for_you",
                });
            } catch (err) {
                app.log.error(err);
                return reply.status(500).send({ error: "For You feed query failed" });
            }
        }

        // ── Popular mode ────────────────────────────────────────────────
        if (mode === "popular") {
            try {
                // Fetch a larger pool for offset-based pagination
                const fetchLimit = Math.min(parsedOffset + parsedLimit, 200);
                const cacheKey = viewerId ? null : `feed:popular:global:7d:${fetchLimit}`;

                let topPosts: any[];
                if (cacheKey) {
                    try {
                        const cached = await app.redis.get(cacheKey);
                        if (cached) {
                            const cachedData = JSON.parse(cached);
                            topPosts = cachedData.data ?? [];
                        } else {
                            topPosts = await getTopPostsWithAnalytics(app.redis, "7d", fetchLimit, viewerId);
                            try {
                                await app.redis.set(cacheKey, JSON.stringify({ data: topPosts }), "EX", POPULAR_CACHE_TTL_SECONDS);
                            } catch (error) {
                                app.log.warn({ err: error }, "Failed to write popular feed cache");
                            }
                        }
                    } catch (error) {
                        app.log.warn({ err: error }, "Failed to read popular feed cache");
                        topPosts = await getTopPostsWithAnalytics(app.redis, "7d", fetchLimit, viewerId);
                    }
                } else {
                    topPosts = await getTopPostsWithAnalytics(app.redis, "7d", fetchLimit, viewerId);
                }

                const page = topPosts.slice(parsedOffset, parsedOffset + parsedLimit);
                const hasMore = topPosts.length > parsedOffset + parsedLimit;

                const payload = {
                    data: page,
                    nextCursor: hasMore ? String(parsedOffset + parsedLimit) : null,
                    count: page.length,
                    mode: "popular",
                };

                return reply.send(payload);
            } catch (err) {
                app.log.error(err);
                return reply.status(500).send({ error: "Popular feed query failed" });
            }
        }

        // ── Trash mode ──────────────────────────────────────────────────
        if (mode === "trash") {
            try {
                const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                const trashFetchLimit = Math.min(parsedOffset + parsedLimit + 1, 201);

                const hasFavSub = viewerId
                    ? sql<boolean>`EXISTS(SELECT 1 FROM interactions i WHERE i.user_id = ${viewerId} AND i.post_id = p.id AND i.type = 'FAV')`
                    : sql<boolean>`false`;
                const hasTrashSub = viewerId
                    ? sql<boolean>`EXISTS(SELECT 1 FROM interactions i WHERE i.user_id = ${viewerId} AND i.post_id = p.id AND i.type = 'TRASH')`
                    : sql<boolean>`false`;

                const trashPosts = await db.execute(sql`
                    SELECT
                        p.id,
                        p.content,
                        p.media_url AS "mediaUrl",
                        p.media_mime_type AS "mediaMimeType",
                        p.link_preview_url AS "linkPreviewUrl",
                        p.link_preview_title AS "linkPreviewTitle",
                        p.link_preview_description AS "linkPreviewDescription",
                        p.link_preview_image_url AS "linkPreviewImageUrl",
                        p.link_preview_site_name AS "linkPreviewSiteName",
                        p.type,
                        p.parent_id AS "parentId",
                        p.fav_count AS "favCount",
                        p.trash_count AS "trashCount",
                        p.reply_count AS "replyCount",
                        p.rt_count AS "rtCount",
                        p.created_at AS "createdAt",
                        u.id AS "authorId",
                        u.username AS "authorUsername",
                        u.profile_pic AS "authorProfilePic",
                        u.role AS "authorRole",
                        c.id AS "communityId",
                        c.slug AS "communitySlug",
                        c.name AS "communityName",
                        ${hasFavSub} AS "hasFav",
                        ${hasTrashSub} AS "hasTrash"
                    FROM posts p
                    INNER JOIN users u ON p.user_id = u.id
                    LEFT JOIN post_communities pc ON pc.post_id = p.id
                    LEFT JOIN communities c ON c.id = pc.community_id
                    WHERE p.trash_count > 0
                      AND p.created_at > ${sevenDaysAgo}
                      AND ${buildViewerBlockFilter(viewerId, sql`p.user_id`)}
                      AND (
                        pc.community_id IS NULL
                        OR c.is_private = false
                        OR EXISTS (
                            SELECT 1
                            FROM community_members cm
                            WHERE cm.community_id = pc.community_id
                              AND cm.user_id = ${viewerId ?? null}
                        )
                      )
                    ORDER BY p.trash_count DESC
                    LIMIT ${trashFetchLimit}
                    OFFSET ${parsedOffset}
                `);

                const rawRows = (trashPosts.rows ?? trashPosts) as any[];
                const page = rawRows.slice(0, parsedLimit);
                const hasMore = rawRows.length > parsedLimit;
                const previewRows = await attachPostViewCounts(
                    page.map((row) => withLinkPreview(row as any) as unknown as { id: string; poll?: any } & Record<string, unknown>)
                );
                const enrichedPosts = await enrichFeedWithPolls(previewRows as Array<{ id: string; poll?: any }>, viewerId);

                return reply.send({
                    data: enrichedPosts,
                    nextCursor: hasMore ? String(parsedOffset + parsedLimit) : null,
                    count: enrichedPosts.length,
                    mode: "trash",
                });
            } catch (err) {
                app.log.error(err);
                return reply.status(500).send({ error: "Trash feed query failed" });
            }
        }

        // ── Latest mode (default) ───────────────────────────────────────
        let followerId: string | undefined;
        if (followFeed === "true") {
            if (!viewerId) return reply.status(401).send({ error: "Authentication required for follow feed" });
            followerId = viewerId;
        }

        try {
            const feed = await getLatestFeed({
                cursor,
                communityId,
                followerId,
                viewerId,
                limit: parsedLimit,
            });

            // Hydrate parent previews server-side so replies always show context
            const parentIds = [...new Set(
                feed
                    .filter((p) => p.parentId)
                    .map((p) => p.parentId as string)
            )];

            let parentPreviews: Record<string, any> = {};
            if (parentIds.length > 0) {
                try {
                    const previewRows = await db.execute(sql`
                        SELECT
                            p.id,
                            p.content,
                            p.media_url AS "mediaUrl",
                            p.media_mime_type AS "mediaMimeType",
                            p.parent_id AS "parentId",
                            u.username AS "authorUsername",
                            u.profile_pic AS "authorProfilePic",
                            parent_u.username AS "parentAuthorUsername"
                        FROM posts p
                        INNER JOIN users u ON u.id = p.user_id
                        LEFT JOIN posts parent_p ON parent_p.id = p.parent_id
                        LEFT JOIN users parent_u ON parent_u.id = parent_p.user_id
                        WHERE p.id IN (${sql.join(parentIds.map(id => sql`${id}`), sql`, `)})
                    `);
                    for (const row of previewRows.rows as any[]) {
                        parentPreviews[row.id] = row;
                    }
                } catch (err) {
                    app.log.warn({ err }, "Failed to hydrate parent previews");
                }
            }

            const hydratedFeed = feed.map((post) => ({
                ...post,
                parentPreview: post.parentId ? (parentPreviews[post.parentId] ?? null) : null,
            }));

            return reply.send({
                data: hydratedFeed,
                nextCursor: getNextCursor(feed, parsedLimit),
                count: feed.length,
                mode: "latest",
            });
        } catch (err) {
            app.log.error(err);
            return reply.status(500).send({ error: "Feed query failed" });
        }
    });

    app.get<{ Params: { slug: string }; Querystring: { cursor?: string; limit?: string; mode?: "latest" | "popular" | "trash"; offset?: string } }>(
        "/communities/:slug/feed",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const limit = Math.min(Math.max(parseInt(request.query.limit ?? "30", 10), 1), 100);
            const viewerId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, viewerId);
            const mode = request.query.mode ?? "latest";
            const communityOffset = request.query.offset ? Math.max(parseInt(request.query.offset, 10) || 0, 0) : 0;

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!access.canView) return reply.status(403).send({ error: "Community is private" });

            if (mode === "popular") {
                const fetchLimit = Math.min(communityOffset + limit, 200);
                const canUseSharedCache = !viewerId && !access.community.isPrivate;
                const cacheKey = canUseSharedCache ? `feed:popular:community:${access.community.id}:7d:${fetchLimit}` : null;

                let fullFeed: any[];
                if (cacheKey) {
                    try {
                        const cached = await app.redis.get(cacheKey);
                        if (cached) {
                            const cachedData = JSON.parse(cached);
                            fullFeed = cachedData.data ?? [];
                        } else {
                            fullFeed = await getCommunityTopPostsWithAnalytics(app.redis, access.community.id, "7d", fetchLimit, viewerId);
                            try {
                                await app.redis.set(cacheKey, JSON.stringify({ data: fullFeed }), "EX", POPULAR_CACHE_TTL_SECONDS);
                            } catch (error) {
                                app.log.warn({ err: error }, "Failed to write community popular cache");
                            }
                        }
                    } catch (error) {
                        app.log.warn({ err: error }, "Failed to read community popular cache");
                        fullFeed = await getCommunityTopPostsWithAnalytics(app.redis, access.community.id, "7d", fetchLimit, viewerId);
                    }
                } else {
                    fullFeed = await getCommunityTopPostsWithAnalytics(app.redis, access.community.id, "7d", fetchLimit, viewerId);
                }

                const page = fullFeed.slice(communityOffset, communityOffset + limit);
                const hasMore = fullFeed.length > communityOffset + limit;

                return reply.send({
                    community: { id: access.community.id, slug: access.community.slug },
                    data: page,
                    nextCursor: hasMore ? String(communityOffset + limit) : null,
                    count: page.length,
                    mode: "popular",
                });
            }

            if (mode === "trash") {
                const trashLimit = Math.min(limit, 50);
                const feed = await getCommunityTrashPosts(access.community.id, communityOffset + trashLimit + 1, viewerId);
                const page = feed.slice(communityOffset, communityOffset + trashLimit);
                const hasMore = feed.length > communityOffset + trashLimit;
                return reply.send({
                    community: { id: access.community.id, slug: access.community.slug },
                    data: page,
                    nextCursor: hasMore ? String(communityOffset + trashLimit) : null,
                    count: page.length,
                    mode: "trash",
                });
            }

            const feed = await getLatestFeed({
                cursor: request.query.cursor,
                communityId: access.community.id,
                viewerId,
                limit,
            });

            return reply.send({
                community: { id: access.community.id, slug: access.community.slug },
                data: feed,
                nextCursor: getNextCursor(feed, limit),
                count: feed.length,
                mode: "latest",
            });
        }
    );

    /**
     * GET /feed/check-new
     * ─────────────────────────────────────────────────────────────────────────
     * Lightweight polling endpoint.
     * Returns the count of root posts created after the `since` timestamp.
     * Example: ?since=2024-03-01T12:00:00.000Z
     */
    app.get<{ Querystring: { since: string } }>("/feed/check-new", async (request, reply) => {
        const { since } = request.query;

        if (!since || isNaN(Date.parse(since))) {
            return reply.status(400).send({ error: "Valid ISO timestamp 'since' query parameter is required" });
        }

        const sinceDate = new Date(since);

        const countQuery = await db.execute<{ count: string }>(sql`
            SELECT COUNT(*)::text AS count
            FROM posts
            WHERE created_at > ${sinceDate}
        `);
        const parsedCount = parseInt(countQuery.rows[0]?.count ?? "0", 10);

        return reply.send({ count: parsedCount });
    });

    /**
     * GET /feed/post/:id
     * Fetch a single post with its thread (parent / children).
     */
    app.get<{ Params: { id: string } }>("/feed/post/:id", { preHandler: app.optionalAuth }, async (request, reply) => {
        const { id } = request.params;
        const viewerId = (request as AuthRequest).userId;

        const post = await db
            .select()
            .from(posts)
            .where(and(eq(posts.id, id), buildViewerBlockFilter(viewerId, posts.userId)))
            .limit(1);

        if (post.length === 0) return reply.status(404).send({ error: "Post not found" });

        const postCommunity = await db
            .select({
                communityId: postCommunities.communityId,
                slug: communities.slug,
                isPrivate: communities.isPrivate,
            })
            .from(postCommunities)
            .innerJoin(communities, eq(postCommunities.communityId, communities.id))
            .where(eq(postCommunities.postId, id))
            .limit(1)
            .then((rows) => rows[0] ?? null);

        if (postCommunity?.isPrivate) {
            const membership = viewerId
                ? await db
                    .select({ communityId: communityMembers.communityId })
                    .from(communityMembers)
                    .where(sql`${communityMembers.communityId} = ${postCommunity.communityId} AND ${communityMembers.userId} = ${viewerId}`)
                    .limit(1)
                : [];

            if (membership.length === 0) {
                return reply.status(404).send({ error: "Post not found" });
            }
        }

        return reply.send({
            data: {
                ...post[0],
                community: postCommunity
                    ? {
                        id: postCommunity.communityId,
                        slug: postCommunity.slug,
                    }
                    : null,
            },
        });
    });
}
