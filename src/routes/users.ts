import { FastifyInstance } from "fastify";
import { db } from "../db";
import { users, posts, follows, interactions, postCommunities, communities, blocks } from "../db/schema";
import { eq, sql, desc, and, like } from "drizzle-orm";
import type { AuthRequest } from "../plugins/auth";
import { withLinkPreview } from "../services/linkPreview";
import { buildViewerBlockFilter } from "../services/blocking";
import { getSuggestedUsers } from "../services/userSuggestions";
import { attachPostViewCounts } from "../services/postViews";

export async function usersRoutes(app: FastifyInstance) {
    app.get(
        "/users/blocks",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;

            const blockedUsers = await db
                .select({
                    id: users.id,
                    username: users.username,
                    profilePic: users.profilePic,
                    bio: users.bio,
                    createdAt: blocks.createdAt,
                })
                .from(blocks)
                .innerJoin(users, eq(blocks.blockedId, users.id))
                .where(eq(blocks.blockerId, userId))
                .orderBy(desc(blocks.createdAt));

            return reply.send({ users: blockedUsers });
        }
    );

    app.post<{ Params: { username: string } }>(
        "/users/:username/block",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const targetUsername = request.params.username.toLowerCase();

            const [target] = await db
                .select({ id: users.id, username: users.username })
                .from(users)
                .where(eq(users.username, targetUsername))
                .limit(1);

            if (!target) return reply.status(404).send({ error: "User not found" });
            if (target.id === userId) return reply.status(400).send({ error: "You cannot block yourself" });

            await db.transaction(async (tx) => {
                await tx
                    .insert(blocks)
                    .values({ blockerId: userId, blockedId: target.id })
                    .onConflictDoNothing();

                await tx
                    .delete(follows)
                    .where(
                        sql`(${follows.followerId} = ${userId} AND ${follows.followingId} = ${target.id})
                            OR (${follows.followerId} = ${target.id} AND ${follows.followingId} = ${userId})`
                    );
            });

            return reply.status(201).send({ success: true, blockedUserId: target.id, username: target.username });
        }
    );

    app.delete<{ Params: { username: string } }>(
        "/users/:username/block",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const targetUsername = request.params.username.toLowerCase();

            const [target] = await db
                .select({ id: users.id, username: users.username })
                .from(users)
                .where(eq(users.username, targetUsername))
                .limit(1);

            if (!target) return reply.status(404).send({ error: "User not found" });

            await db
                .delete(blocks)
                .where(and(eq(blocks.blockerId, userId), eq(blocks.blockedId, target.id)));

            return reply.send({ success: true, username: target.username });
        }
    );

    /**
     * GET /users/:username
     * ─────────────────────────────────────────────────────────────────────────
     * Full public profile. Returns:
     *   @username, bio, profilePic, role,
     *   followerCount, followingCount, postCount,
     *   isFollowing (if the requester is authenticated),
     *   joinedAt
     */
    app.get<{ Params: { username: string } }>(
        "/users/:username",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const { username } = request.params;
            const viewerId = (request as AuthRequest).userId; // may be undefined

            // ── Fetch base user ─────────────────────────────────────────────────
            const [user] = await db
                .select({
                    id: users.id,
                    username: users.username,
                    bio: users.bio,
                    profilePic: users.profilePic,
                    coverPic: users.coverPic,
                    role: users.role,
                    isActive: users.isActive,
                    createdAt: users.createdAt,
                })
                .from(users)
                .where(and(eq(users.username, username.toLowerCase()), buildViewerBlockFilter(viewerId, users.id)))
                .limit(1);

            if (!user) return reply.status(404).send({ error: "User not found" });
            if (!user.isActive) return reply.status(410).send({ error: "Account suspended" });

            // ── Counts in one query ─────────────────────────────────────────────
            // db.execute returns QueryResult, not an array — access via .rows
            const [countsResult, followRows, followerRows] = await Promise.all([
                db.execute<{
                    followerCount: string;
                    followingCount: string;
                    postCount: string;
                    totalFavCount: string;
                    totalTrashCount: string;
                }>(sql`
                    SELECT
                      (SELECT COUNT(*) FROM follows WHERE following_id = ${user.id})::text AS "followerCount",
                      (SELECT COUNT(*) FROM follows WHERE follower_id  = ${user.id})::text AS "followingCount",
                      (SELECT COUNT(*) FROM posts  WHERE user_id       = ${user.id}
                         AND type = 'post')::text                                          AS "postCount",
                      (SELECT COALESCE(SUM(fav_count), 0) FROM posts WHERE user_id = ${user.id})::text AS "totalFavCount",
                      (SELECT COALESCE(SUM(trash_count), 0) FROM posts WHERE user_id = ${user.id})::text AS "totalTrashCount"
                `),
                viewerId && viewerId !== user.id
                    ? db
                        .select({ followerId: follows.followerId })
                        .from(follows)
                        .where(and(eq(follows.followerId, viewerId), eq(follows.followingId, user.id)))
                        .limit(1)
                    : Promise.resolve([]),
                viewerId && viewerId !== user.id
                    ? db
                        .select({ followerId: follows.followerId })
                        .from(follows)
                        .where(and(eq(follows.followerId, user.id), eq(follows.followingId, viewerId)))
                        .limit(1)
                    : Promise.resolve([]),
            ]);
            const counts = countsResult.rows[0];
            const isFollowing = followRows.length > 0;
            const followsYou = followerRows.length > 0;

            return reply.send({
                user: {
                    id: user.id,
                    handle: `@${user.username}`,
                    username: user.username,
                    bio: user.bio,
                    profilePic: user.profilePic,
                    coverPic: user.coverPic,
                    role: user.role,
                    followerCount: parseInt(counts?.followerCount ?? "0", 10),
                    followingCount: parseInt(counts?.followingCount ?? "0", 10),
                    postCount: parseInt(counts?.postCount ?? "0", 10),
                    totalFavCount: parseInt(counts?.totalFavCount ?? "0", 10),
                    totalTrashCount: parseInt(counts?.totalTrashCount ?? "0", 10),
                    isFollowing,
                    followsYou,
                    canDm: isFollowing && followsYou,
                    joinedAt: user.createdAt,
                },
            });
        }
    );

    /**
     * GET /users/:username/posts
     * ─────────────────────────────────────────────────────────────────────────
     * Paginated post history (text + media + RT) for a profile page.
     * ?type=post|rt|quote   filter by type
     * ?page=1
     */
    app.get<{
        Params: { username: string };
        Querystring: { page?: string; type?: "post" | "rt" | "quote" };
    }>(
        "/users/:username/posts",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const { username } = request.params;
            const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
            const type = request.query.type ?? undefined;
            const viewerId = (request as AuthRequest).userId;
            const limit = 20;
            const offset = (page - 1) * limit;

            const [user] = await db
                .select({ id: users.id })
                .from(users)
                .where(and(eq(users.username, username.toLowerCase()), buildViewerBlockFilter(viewerId, users.id)))
                .limit(1);

            if (!user) return reply.status(404).send({ error: "User not found" });

            const hasFavSelect = viewerId
                ? sql<boolean>`EXISTS(
                    SELECT 1 FROM interactions i
                    WHERE i.user_id = ${viewerId}
                      AND i.post_id = ${posts.id}
                      AND i.type = 'FAV'
                )`
                : sql<boolean>`false`;

            const hasTrashSelect = viewerId
                ? sql<boolean>`EXISTS(
                    SELECT 1 FROM interactions i
                    WHERE i.user_id = ${viewerId}
                      AND i.post_id = ${posts.id}
                      AND i.type = 'TRASH'
                )`
                : sql<boolean>`false`;

            const query = db
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
                    communityId: communities.id,
                    communitySlug: communities.slug,
                    communityName: communities.name,
                    hasFav: hasFavSelect,
                    hasTrash: hasTrashSelect,
                })
                .from(posts)
                .leftJoin(postCommunities, eq(postCommunities.postId, posts.id))
                .leftJoin(communities, eq(postCommunities.communityId, communities.id))
                .where(
                    type === "rt"
                        ? sql`${posts.userId} = ${user.id} AND ${posts.type} IN ('rt', 'quote') AND (${postCommunities.communityId} IS NULL OR ${communities.isPrivate} = false) AND ${buildViewerBlockFilter(viewerId, posts.userId)}`
                        : type
                            ? sql`${posts.userId} = ${user.id} AND ${posts.type} = ${type} AND (${postCommunities.communityId} IS NULL OR ${communities.isPrivate} = false) AND ${buildViewerBlockFilter(viewerId, posts.userId)}`
                            : sql`${posts.userId} = ${user.id} AND (${postCommunities.communityId} IS NULL OR ${communities.isPrivate} = false) AND ${buildViewerBlockFilter(viewerId, posts.userId)}`
                )
                .orderBy(desc(posts.createdAt))
                .limit(limit)
                .offset(offset);

            const results = await query;
            const postsWithViews = await attachPostViewCounts(results.map((row) => withLinkPreview(row)));
            return reply.send({ posts: postsWithViews, page, hasMore: results.length === limit });
        }
    );

    /**
     * GET /search/users?q=
     * Search users by username prefix.
     */
    app.get<{ Querystring: { q?: string; page?: string; mutualOnly?: string } }>(
        "/search/users",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const q = (request.query.q ?? "").toLowerCase().trim();
            const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
            const mutualOnly = request.query.mutualOnly === "true";
            const limit = 20;
            const offset = (page - 1) * limit;
            const viewerId = (request as AuthRequest).userId;

            if (q.length < 1) return reply.send({ users: [] });
            if (mutualOnly && !viewerId) return reply.send({ users: [] });

            // Remove leading @ if typed
            const clean = q.startsWith("@") ? q.slice(1) : q;

            const results = await db
                .select({
                    id: users.id,
                    username: users.username,
                    handle: sql<string>`'@' || ${users.username}`,
                    bio: users.bio,
                    profilePic: users.profilePic,
                    role: users.role,
                })
                .from(users)
                .where(and(
                    like(users.username, `${clean}%`),
                    eq(users.isActive, true),
                    buildViewerBlockFilter(viewerId, users.id),
                    mutualOnly
                        ? sql`EXISTS (
                            SELECT 1
                            FROM ${follows} outbound
                            WHERE outbound.follower_id = ${viewerId}
                              AND outbound.following_id = ${users.id}
                        ) AND EXISTS (
                            SELECT 1
                            FROM ${follows} inbound
                            WHERE inbound.follower_id = ${users.id}
                              AND inbound.following_id = ${viewerId}
                        )`
                        : sql`true`
                ))
                .orderBy(users.username)
                .limit(limit)
                .offset(offset);

            return reply.send({ users: results, page });
        }
    );

    app.get<{ Querystring: { limit?: string } }>(
        "/search/users/suggestions",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const viewerId = (request as AuthRequest).userId;
            const limit = Math.max(1, parseInt(request.query.limit ?? "6", 10));

            if (!viewerId) {
                return reply.send({ users: [] });
            }

            const users = await getSuggestedUsers(viewerId, limit);
            return reply.send({ users });
        }
    );
}
