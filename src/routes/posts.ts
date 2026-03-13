import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db";
import { communities, communityMembers, follows, interactions, notifications, polls, pollOptions, pollVotes, postCommunities, posts, users } from "../db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import type { AuthRequest } from "../plugins/auth";
import { createPostForUser, CreatePostSchema } from "../services/postCreation";
import { incrementCounter } from "../services/analytics";
import { withLinkPreview } from "../services/linkPreview";
import { buildViewerBlockFilter } from "../services/blocking";
import { attachPostViewCounts } from "../services/postViews";

const GetPostQuerySchema = z.object({
    limit: z.string().optional(),
    maxDepth: z.string().optional(),
});

export async function postsRoutes(app: FastifyInstance) {

    /**
     * POST /posts
     * Create a new post / retweet / quote.
     */
    app.post(
        "/posts",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;

            const body = CreatePostSchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });
            }

            const result = await createPostForUser({
                userId,
                post: body.data,
                redis: app.redis,
            });

            if (result.status === 201) {
                try {
                    await incrementCounter(app.redis, "posts_created");
                } catch (error) {
                    app.log.warn({ err: error }, "Failed to track post metric");
                }
            }

            if ("notifyUserId" in result.body) {
                const { notifyUserId, ...publicBody } = result.body;
                return reply.status(result.status).send(publicBody);
            }

            return reply.status(result.status).send(result.body);
        }
    );

    /**
     * POST /polls/:id/vote
     * Vote on a poll
     */
    app.post<{ Params: { id: string } }>(
        "/polls/:id/vote",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const { id } = request.params;

            const VoteSchema = z.object({
                optionId: z.string().uuid(),
            });

            const body = VoteSchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });
            }

            const { optionId } = body.data;

            try {
                const result = await db.transaction(async (tx) => {
                    // Check if poll exists and is active
                    const [poll] = await tx.select().from(polls).where(eq(polls.id, id)).limit(1);
                    if (!poll) {
                        return { status: 404, error: "Poll not found" };
                    }

                    if (new Date() > poll.expiresAt) {
                        return { status: 400, error: "Poll has expired" };
                    }

                    // Check if user already voted
                    const [existingVote] = await tx
                        .select()
                        .from(pollVotes)
                        .where(and(eq(pollVotes.pollId, id), eq(pollVotes.userId, userId)))
                        .limit(1);

                    if (existingVote) {
                        return { status: 400, error: "You have already voted on this poll" };
                    }

                    // Verify option belongs to poll
                    const [option] = await tx
                        .select()
                        .from(pollOptions)
                        .where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, id)))
                        .limit(1);

                    if (!option) {
                        return { status: 404, error: "Option not found in this poll" };
                    }

                    // Insert vote
                    await tx.insert(pollVotes).values({
                        userId,
                        pollId: id,
                        optionId,
                    });

                    // Increment option vote count
                    await tx
                        .update(pollOptions)
                        .set({ voteCount: sql`${pollOptions.voteCount} + 1` })
                        .where(eq(pollOptions.id, optionId));

                    return { status: 200, success: true };
                });

                if (result.error) {
                    return reply.status(result.status).send({ error: result.error });
                }

                return reply.send({ success: true });
            } catch (error: any) {
                if (error.code === '23505') { // Unique violation
                    return reply.status(400).send({ error: "You have already voted on this poll" });
                }
                app.log.error(error);
                return reply.status(500).send({ error: "Internal server error" });
            }
        }
    );

    /**
     * GET /posts/:id
     * Fetch a single post with author info and 20 top replies.
     */
    app.get<{ Params: { id: string }; Querystring: { limit?: string; maxDepth?: string } }>(
        "/posts/:id",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const { id } = request.params;
            const viewerId = (request as AuthRequest).userId;
            const parsedQuery = GetPostQuerySchema.safeParse(request.query);
            if (!parsedQuery.success) {
                return reply.status(400).send({ error: "Invalid query parameters", details: parsedQuery.error.flatten() });
            }

            const requestedLimit = parsedQuery.data.limit ? parseInt(parsedQuery.data.limit, 10) : 100;
            const requestedMaxDepth = parsedQuery.data.maxDepth ? parseInt(parsedQuery.data.maxDepth, 10) : 8;
            const repliesLimit = Number.isFinite(requestedLimit)
                ? Math.min(Math.max(requestedLimit, 1), 100)
                : 100;
            const maxDepth = Number.isFinite(requestedMaxDepth)
                ? Math.min(Math.max(requestedMaxDepth, 1), 12)
                : 8;

            const [result, pollInfo] = await Promise.all([
                db
                    .select({
                        id: posts.id,
                        content: posts.content,
                        mediaUrl: posts.mediaUrl,
                        mediaMimeType: posts.mediaMimeType,
                        linkPreviewUrl: posts.linkPreviewUrl,
                        linkPreviewTitle: posts.linkPreviewTitle,
                        linkPreviewDescription: posts.linkPreviewDescription,
                        linkPreviewImageUrl: posts.linkPreviewImageUrl,
                        linkPreviewSiteName: posts.linkPreviewSiteName,
                        type: posts.type,
                        parentId: posts.parentId,
                        favCount: posts.favCount,
                        trashCount: posts.trashCount,
                        replyCount: posts.replyCount,
                        rtCount: posts.rtCount,
                        createdAt: posts.createdAt,
                        authorId: users.id,
                        authorUsername: users.username,
                        authorProfilePic: users.profilePic,
                        authorRole: users.role,
                        communityId: communities.id,
                        communitySlug: communities.slug,
                        communityName: communities.name,
                        communityIsPrivate: communities.isPrivate,
                    })
                    .from(posts)
                    .innerJoin(users, eq(posts.userId, users.id))
                    .leftJoin(postCommunities, eq(postCommunities.postId, posts.id))
                    .leftJoin(communities, eq(postCommunities.communityId, communities.id))
                    .where(and(eq(posts.id, id), buildViewerBlockFilter(viewerId, posts.userId)))
                    .limit(1),
                db
                    .select()
                    .from(polls)
                    .where(eq(polls.postId, id))
                    .limit(1)
                    .then((rows) => rows[0] ?? null),
            ]);

            if (result.length === 0) return reply.status(404).send({ error: "Post not found" });

            const basePost = withLinkPreview(result[0]);
            if (basePost.communityIsPrivate) {
                const membership = viewerId
                    ? await db
                        .select({ communityId: communityMembers.communityId })
                        .from(communityMembers)
                        .where(and(eq(communityMembers.communityId, basePost.communityId!), eq(communityMembers.userId, viewerId)))
                        .limit(1)
                    : [];

                if (membership.length === 0) {
                    return reply.status(404).send({ error: "Post not found" });
                }
            }

            const hasFavSub = viewerId
                ? sql<boolean>`EXISTS(SELECT 1 FROM interactions i WHERE i.user_id = ${viewerId} AND i.post_id = ${posts.id} AND i.type = 'FAV')`
                : sql<boolean>`false`;
            const hasTrashSub = viewerId
                ? sql<boolean>`EXISTS(SELECT 1 FROM interactions i WHERE i.user_id = ${viewerId} AND i.post_id = ${posts.id} AND i.type = 'TRASH')`
                : sql<boolean>`false`;

            let pollData = null;

            if (pollInfo) {
                const [options, vote] = await Promise.all([
                    db
                        .select()
                        .from(pollOptions)
                        .where(eq(pollOptions.pollId, pollInfo.id))
                        .orderBy(pollOptions.id),
                    viewerId
                        ? db
                            .select({ optionId: pollVotes.optionId })
                            .from(pollVotes)
                            .where(and(eq(pollVotes.pollId, pollInfo.id), eq(pollVotes.userId, viewerId)))
                            .limit(1)
                            .then((rows) => rows[0] ?? null)
                        : Promise.resolve(null),
                ]);

                pollData = {
                    ...pollInfo,
                    options,
                    userVotedOptionId: vote?.optionId ?? null,
                };
            }

            const [repliesResult, ancestorsResult, parentPostResult] = await Promise.all([
                db.execute(sql`
                WITH RECURSIVE thread_replies AS (
                    SELECT
                        p.id,
                        p.parent_id AS "parentId",
                        p.content,
                        p.media_url AS "mediaUrl",
                        p.media_mime_type AS "mediaMimeType",
                        p.fav_count AS "favCount",
                        p.trash_count AS "trashCount",
                        p.reply_count AS "replyCount",
                        p.rt_count AS "rtCount",
                        p.created_at AS "createdAt",
                        u.username AS "authorUsername",
                        u.profile_pic AS "authorProfilePic",
                        u.role AS "authorRole",
                        0 AS depth,
                        ARRAY[p.created_at::text, p.id::text] AS sort_path
                    FROM posts p
                    INNER JOIN users u ON u.id = p.user_id
                    WHERE p.parent_id = ${id} AND p.type = 'post'
                      AND ${buildViewerBlockFilter(viewerId, sql`p.user_id`)}

                    UNION ALL

                    SELECT
                        child.id,
                        child.parent_id AS "parentId",
                        child.content,
                        child.media_url AS "mediaUrl",
                        child.media_mime_type AS "mediaMimeType",
                        child.fav_count AS "favCount",
                        child.trash_count AS "trashCount",
                        child.reply_count AS "replyCount",
                        child.rt_count AS "rtCount",
                        child.created_at AS "createdAt",
                        child_user.username AS "authorUsername",
                        child_user.profile_pic AS "authorProfilePic",
                        child_user.role AS "authorRole",
                        thread_replies.depth + 1 AS depth,
                        thread_replies.sort_path || ARRAY[child.created_at::text, child.id::text] AS sort_path
                    FROM posts child
                    INNER JOIN users child_user ON child_user.id = child.user_id
                    INNER JOIN thread_replies ON thread_replies.id = child.parent_id
                    WHERE child.type = 'post'
                      AND ${buildViewerBlockFilter(viewerId, sql`child.user_id`)}
                      AND thread_replies.depth + 1 < ${maxDepth}
                )
                SELECT
                    thread_replies.id,
                    thread_replies."parentId",
                    thread_replies.content,
                    thread_replies."mediaUrl",
                    thread_replies."mediaMimeType",
                    thread_replies."favCount",
                    thread_replies."trashCount",
                    thread_replies."replyCount",
                    thread_replies."rtCount",
                    thread_replies."createdAt",
                    thread_replies."authorUsername",
                    thread_replies."authorProfilePic",
                    thread_replies."authorRole",
                    thread_replies.depth,
                    ${viewerId
                        ? sql<boolean>`EXISTS(
                                SELECT 1
                                FROM interactions i
                                WHERE i.user_id = ${viewerId}
                                  AND i.post_id = thread_replies.id
                                  AND i.type = 'FAV'
                            )`
                        : sql<boolean>`false`
                    } AS "hasFav",
                    ${viewerId
                        ? sql<boolean>`EXISTS(
                                SELECT 1
                                FROM interactions i
                                WHERE i.user_id = ${viewerId}
                                  AND i.post_id = thread_replies.id
                                  AND i.type = 'TRASH'
                            )`
                        : sql<boolean>`false`
                    } AS "hasTrash"
                FROM thread_replies
                ORDER BY thread_replies.sort_path
                LIMIT ${repliesLimit}
            `),
                basePost.parentId && basePost.type === "post"
                    ? db.execute(sql`
                        WITH RECURSIVE ancestor_chain AS (
                            SELECT
                                p.id,
                                p.parent_id AS "parentId",
                                p.content,
                                p.media_url AS "mediaUrl",
                                p.media_mime_type AS "mediaMimeType",
                                p.created_at AS "createdAt",
                                u.username AS "authorUsername",
                                u.profile_pic AS "authorProfilePic",
                                0 AS depth
                            FROM posts p
                            INNER JOIN users u ON u.id = p.user_id
                            WHERE p.id = ${basePost.parentId}
                              AND ${buildViewerBlockFilter(viewerId, sql`p.user_id`)}

                            UNION ALL

                            SELECT
                                parent.id,
                                parent.parent_id AS "parentId",
                                parent.content,
                                parent.media_url AS "mediaUrl",
                                parent.media_mime_type AS "mediaMimeType",
                                parent.created_at AS "createdAt",
                                parent_user.username AS "authorUsername",
                                parent_user.profile_pic AS "authorProfilePic",
                                ancestor_chain.depth + 1 AS depth
                            FROM posts parent
                            INNER JOIN users parent_user ON parent_user.id = parent.user_id
                            INNER JOIN ancestor_chain ON ancestor_chain."parentId" = parent.id
                            WHERE ancestor_chain.depth + 1 < ${maxDepth}
                              AND ${buildViewerBlockFilter(viewerId, sql`parent.user_id`)}
                        )
                        SELECT
                            id,
                            "parentId",
                            content,
                            "mediaUrl",
                            "mediaMimeType",
                            "createdAt",
                            "authorUsername",
                            "authorProfilePic",
                            depth
                        FROM ancestor_chain
                        ORDER BY depth DESC
                    `)
                    : Promise.resolve({ rows: [] }),
                basePost.parentId && basePost.type !== "post"
                    ? db
                        .select({
                            id: posts.id,
                            parentId: posts.parentId,
                            content: posts.content,
                            mediaUrl: posts.mediaUrl,
                            mediaMimeType: posts.mediaMimeType,
                            linkPreviewUrl: posts.linkPreviewUrl,
                            linkPreviewTitle: posts.linkPreviewTitle,
                            linkPreviewDescription: posts.linkPreviewDescription,
                            linkPreviewImageUrl: posts.linkPreviewImageUrl,
                            linkPreviewSiteName: posts.linkPreviewSiteName,
                            createdAt: posts.createdAt,
                            authorUsername: users.username,
                            authorProfilePic: users.profilePic,
                        })
                        .from(posts)
                        .innerJoin(users, eq(posts.userId, users.id))
                        .where(and(eq(posts.id, basePost.parentId), buildViewerBlockFilter(viewerId, posts.userId)))
                        .limit(1)
                    : Promise.resolve([]),
            ]);

            const replies = repliesResult.rows as Array<{
                id: string;
                parentId: string | null;
                content: string | null;
                mediaUrl: string | null;
                mediaMimeType: string | null;
                favCount: number;
                trashCount: number;
                replyCount: number;
                rtCount: number;
                createdAt: string;
                authorUsername: string;
                authorProfilePic: string | null;
                authorRole: "user" | "elite" | "admin";
                depth: number;
                hasFav: boolean;
                hasTrash: boolean;
            }>;

            const ancestors = ancestorsResult.rows as Array<{
                id: string;
                parentId: string | null;
                content: string | null;
                mediaUrl: string | null;
                mediaMimeType: string | null;
                createdAt: string;
                authorUsername: string;
                authorProfilePic: string | null;
                depth: number;
            }>;

            const [postWithViews] = await attachPostViewCounts([{ ...basePost, poll: pollData }]);

            return reply.send({
                post: postWithViews,
                replies,
                ancestors,
                parentPost: parentPostResult[0] ? withLinkPreview(parentPostResult[0]) : null,
            });
        }
    );

    /**
     * DELETE /posts/:id
     * Delete own post. Admins can delete any post.
     */
    app.delete<{ Params: { id: string } }>(
        "/posts/:id",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId, userRole } = request as AuthRequest;
            const { id } = request.params;

            const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
            if (!post) return reply.status(404).send({ error: "Post not found" });

            if (post.userId !== userId && userRole !== "admin") {
                return reply.status(403).send({ error: "Forbidden" });
            }

            // Decrement parent counters before deleting
            if (post.parentId) {
                const isRepostFamily = post.type === "rt" || post.type === "quote";
                const field = isRepostFamily ? "rtCount" : "replyCount";
                const col = isRepostFamily ? posts.rtCount : posts.replyCount;
                await db
                    .update(posts)
                    .set({ [field]: sql`GREATEST(0, ${col} - 1)` })
                    .where(eq(posts.id, post.parentId));
            }

            await db.delete(posts).where(eq(posts.id, id));
            return reply.status(204).send();
        }
    );
    /**
     * POST /posts/batch-preview
     * ─────────────────────────────────────────────────────────────────────────
     * Batch fetch lightweight previews for multiple posts (used by feed
     * to hydrate RT/quote/reply parent previews in a single round-trip).
     * Body: { ids: string[] } — max 20
     */
    app.post(
        "/posts/batch-preview",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const schema = z.object({ ids: z.array(z.string().uuid()).max(20) });
            const parsed = schema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid body", details: parsed.error.flatten() });
            }

            const { ids } = parsed.data;
            if (ids.length === 0) {
                return reply.send({ previews: {} });
            }

            const result = await db.execute(sql`
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
                    p.parent_id AS "parentId",
                    u.username AS "authorUsername",
                    u.profile_pic AS "authorProfilePic",
                    c.id AS "communityId",
                    c.slug AS "communitySlug",
                    parent_u.username AS "parentAuthorUsername"
                FROM posts p
                INNER JOIN users u ON u.id = p.user_id
                LEFT JOIN post_communities pc ON pc.post_id = p.id
                LEFT JOIN communities c ON c.id = pc.community_id
                LEFT JOIN posts parent_p ON parent_p.id = p.parent_id
                LEFT JOIN users parent_u ON parent_u.id = parent_p.user_id
                WHERE p.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
                  AND (pc.community_id IS NULL OR c.is_private = false)
            `);

            const previews: Record<string, any> = {};
            for (const row of result.rows as any[]) {
                previews[row.id] = {
                    ...withLinkPreview(row),
                    parentId: row.parentId ?? null,
                    parentAuthorUsername: row.parentAuthorUsername ?? null,
                };
            }

            return reply.send({ previews });
        }
    );
}
