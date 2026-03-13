import { FastifyInstance } from "fastify";
import { db } from "../db";
import { follows, users, notifications, blocks } from "../db/schema";
import { and, eq } from "drizzle-orm";
import type { AuthRequest } from "../plugins/auth";
import { publishNotificationEvent } from "../services/notificationHub";
import { incrementCounter } from "../services/analytics";
import { buildViewerBlockFilter } from "../services/blocking";

export async function followRoutes(app: FastifyInstance) {

    /**
     * POST /users/:username/follow
     * Follow a user. Idempotent (safe to call multiple times).
     */
    app.post<{ Params: { username: string } }>(
        "/users/:username/follow",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId: followerId } = request as AuthRequest;
            const { username } = request.params;

            const result = await db.transaction(async (tx) => {
                const [target] = await tx
                    .select({ id: users.id })
                    .from(users)
                    .where(eq(users.username, username.toLowerCase()))
                    .limit(1);

                if (!target) return { status: 404 as const, body: { error: "User not found" } };
                if (target.id === followerId) {
                    return { status: 400 as const, body: { error: "You cannot follow yourself" } };
                }

                const [blockRelation] = await tx
                    .select({ blockerId: blocks.blockerId })
                    .from(blocks)
                    .where(
                        and(
                            eq(blocks.blockerId, followerId),
                            eq(blocks.blockedId, target.id)
                        )
                    )
                    .limit(1);

                if (blockRelation) {
                    return { status: 400 as const, body: { error: "You have blocked this user" } };
                }

                const [blockedByTarget] = await tx
                    .select({ blockerId: blocks.blockerId })
                    .from(blocks)
                    .where(
                        and(
                            eq(blocks.blockerId, target.id),
                            eq(blocks.blockedId, followerId)
                        )
                    )
                    .limit(1);

                if (blockedByTarget) {
                    return { status: 403 as const, body: { error: "You cannot follow this user" } };
                }

                const insertResult = await tx
                    .insert(follows)
                    .values({ followerId, followingId: target.id })
                    .onConflictDoNothing();

                if (insertResult.rowCount && insertResult.rowCount > 0) {
                    await tx.insert(notifications).values({
                        userId: target.id,
                        actorId: followerId,
                        type: "follow",
                    });
                }

                return {
                    status: insertResult.rowCount && insertResult.rowCount > 0 ? 201 as const : 200 as const,
                    body: {
                        following: username,
                        isFollowing: true,
                        targetUserId: target.id,
                        notificationCreated: Boolean(insertResult.rowCount && insertResult.rowCount > 0),
                    },
                };
            });

            if ("notificationCreated" in result.body && result.body.notificationCreated) {
                try {
                    await incrementCounter(app.redis, "follows_created");
                } catch (error) {
                    app.log.warn({ err: error }, "Failed to track follow metric");
                }
                publishNotificationEvent({
                    event: "notification:new",
                    userId: result.body.targetUserId,
                    actorId: followerId,
                    notificationType: "follow",
                    at: new Date().toISOString(),
                });
            }

            if ("targetUserId" in result.body) {
                const { targetUserId, notificationCreated, ...publicBody } = result.body;
                return reply.status(result.status).send(publicBody);
            }

            return reply.status(result.status).send(result.body);
        }
    );

    /**
     * DELETE /users/:username/follow
     * Unfollow a user.
     */
    app.delete<{ Params: { username: string } }>(
        "/users/:username/follow",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId: followerId } = request as AuthRequest;
            const { username } = request.params;

            const [target] = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.username, username.toLowerCase()))
                .limit(1);

            if (!target) return reply.status(404).send({ error: "User not found" });

            await db
                .delete(follows)
                .where(and(eq(follows.followerId, followerId), eq(follows.followingId, target.id)));

            return reply.send({ following: username, isFollowing: false });
        }
    );

    /**
     * GET /users/:username/followers
     * List users who follow :username.
     */
    app.get<{ Params: { username: string }; Querystring: { page?: string } }>(
        "/users/:username/followers",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const { username } = request.params;
            const viewerId = (request as AuthRequest).userId;
            const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
            const limit = 40;
            const offset = (page - 1) * limit;

            const [target] = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.username, username.toLowerCase()))
                .limit(1);

            if (!target) return reply.status(404).send({ error: "User not found" });

            const followerList = await db
                .select({
                    id: users.id,
                    username: users.username,
                    profilePic: users.profilePic,
                    bio: users.bio,
                })
                .from(follows)
                .innerJoin(users, eq(follows.followerId, users.id))
                .where(and(eq(follows.followingId, target.id), buildViewerBlockFilter(viewerId, users.id)))
                .limit(limit)
                .offset(offset);

            return reply.send({ followers: followerList, page });
        }
    );

    /**
     * GET /users/:username/following
     * List users that :username follows.
     */
    app.get<{ Params: { username: string }; Querystring: { page?: string } }>(
        "/users/:username/following",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const { username } = request.params;
            const viewerId = (request as AuthRequest).userId;
            const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
            const limit = 40;
            const offset = (page - 1) * limit;

            const [target] = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.username, username.toLowerCase()))
                .limit(1);

            if (!target) return reply.status(404).send({ error: "User not found" });

            const followingList = await db
                .select({
                    id: users.id,
                    username: users.username,
                    profilePic: users.profilePic,
                    bio: users.bio,
                })
                .from(follows)
                .innerJoin(users, eq(follows.followingId, users.id))
                .where(and(eq(follows.followerId, target.id), buildViewerBlockFilter(viewerId, users.id)))
                .limit(limit)
                .offset(offset);

            return reply.send({ following: followingList, page });
        }
    );
}
