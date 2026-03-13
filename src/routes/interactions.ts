import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db";
import { interactions, posts, notifications } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { AuthRequest } from "../plugins/auth";
import { publishNotificationEvent } from "../services/notificationHub";
import { incrementCounter } from "../services/analytics";

const InteractSchema = z.object({
    type: z.enum(["FAV", "TRASH"]),
});

export async function interactionRoutes(app: FastifyInstance) {

    /**
     * POST /posts/:id/interact
     * FAV or TRASH a post. Toggles: if already set, removes it.
     * A user cannot simultaneously FAV and TRASH the same post.
     */
    app.post<{ Params: { id: string } }>(
        "/posts/:id/interact",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const { id: postId } = request.params;

            const body = InteractSchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "type must be 'FAV' or 'TRASH'" });
            }

            const { type } = body.data;
            const oppositeType = type === "FAV" ? "TRASH" : "FAV";

            const result = await db.transaction(async (tx) => {
                const [targetPost] = await tx
                    .select({ id: posts.id, userId: posts.userId })
                    .from(posts)
                    .where(eq(posts.id, postId))
                    .limit(1);

                if (!targetPost) {
                    return { status: 404 as const, body: { error: "Post not found" } };
                }

                const existingInteractions = await tx
                    .select({
                        id: interactions.id,
                        type: interactions.type,
                    })
                    .from(interactions)
                    .where(and(eq(interactions.userId, userId), eq(interactions.postId, postId)));

                const existing = existingInteractions.find((row) => row.type === type);

                if (existing) {
                    const field = type === "FAV" ? "favCount" : "trashCount";
                    await tx.delete(interactions).where(eq(interactions.id, existing.id));
                    await tx
                        .update(posts)
                        .set({ [field]: sql`GREATEST(0, ${type === "FAV" ? posts.favCount : posts.trashCount} - 1)` })
                        .where(eq(posts.id, postId));

                    return {
                        status: 200 as const,
                        body: { action: "removed", type, targetUserId: targetPost.userId },
                    };
                }

                const opposite = existingInteractions.find((row) => row.type === oppositeType);

                if (opposite) {
                    const oppositeField = oppositeType === "FAV" ? "favCount" : "trashCount";
                    await tx.delete(interactions).where(eq(interactions.id, opposite.id));
                    await tx
                        .update(posts)
                        .set({ [oppositeField]: sql`GREATEST(0, ${oppositeType === "FAV" ? posts.favCount : posts.trashCount} - 1)` })
                        .where(eq(posts.id, postId));
                }

                await tx.insert(interactions).values({ userId, postId, type });

                const field = type === "FAV" ? "favCount" : "trashCount";
                await tx
                    .update(posts)
                    .set({ [field]: sql`${type === "FAV" ? posts.favCount : posts.trashCount} + 1` })
                    .where(eq(posts.id, postId));

                if (type === "FAV" && targetPost.userId !== userId) {
                    await tx.insert(notifications).values({
                        userId: targetPost.userId,
                        actorId: userId,
                        type: "fav",
                        postId,
                    });
                }

                return {
                    status: 201 as const,
                    body: { action: "added", type, targetUserId: targetPost.userId },
                };
            });

            if (result.status === 201 && result.body.action === "added" && type === "FAV" && result.body.targetUserId !== userId) {
                try {
                    await incrementCounter(app.redis, "favs_added");
                } catch (error) {
                    app.log.warn({ err: error }, "Failed to track fav metric");
                }
                publishNotificationEvent({
                    event: "notification:new",
                    userId: result.body.targetUserId,
                    actorId: userId,
                    postId,
                    notificationType: "fav",
                    at: new Date().toISOString(),
                });
            }

            if ("targetUserId" in result.body) {
                const { targetUserId, ...publicBody } = result.body;
                return reply.status(result.status).send(publicBody);
            }

            return reply.status(result.status).send(result.body);
        }
    );

    /**
     * GET /posts/:id/interactions
     * Returns fav/trash counts + the requesting user's own interaction state.
     */
    app.get<{ Params: { id: string } }>(
        "/posts/:id/interactions",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const { id: postId } = request.params;
            const userId = (request as AuthRequest).userId;

            const myInteractionSelect = userId
                ? sql<string | null>`(
                    SELECT i.type::text
                    FROM interactions i
                    WHERE i.user_id = ${userId}
                      AND i.post_id = ${postId}
                    LIMIT 1
                )`
                : sql<string | null>`NULL`;

            const [post] = await db
                .select({
                    favCount: posts.favCount,
                    trashCount: posts.trashCount,
                    myInteraction: myInteractionSelect,
                })
                .from(posts)
                .where(eq(posts.id, postId))
                .limit(1);

            if (!post) return reply.status(404).send({ error: "Post not found" });

            return reply.send({
                favCount: post.favCount,
                trashCount: post.trashCount,
                myInteraction: post.myInteraction ?? null,
            });
        }
    );
}
