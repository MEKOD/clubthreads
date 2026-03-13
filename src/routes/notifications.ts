import { FastifyInstance } from "fastify";
import { db } from "../db";
import { communities, notifications, users, posts } from "../db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { AuthRequest } from "../plugins/auth";
import { z } from "zod";
import { publishNotificationEvent, subscribeToNotifications } from "../services/notificationHub";
import { getVapidPublicKey } from "../services/webPush";
import { buildViewerBlockFilter } from "../services/blocking";

const NotificationsQuerySchema = z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
});

const MarkReadSchema = z.object({
    ids: z.array(z.string().uuid()).optional(),
});

const ResolveNotificationSchema = z.object({
    actionStatus: z.enum(["accepted", "rejected"]),
});

export async function notificationsRoutes(app: FastifyInstance) {
    app.get(
        "/notifications/vapid-public-key",
        { preHandler: app.authenticate },
        async (_request, reply) => {
            const publicKey = getVapidPublicKey();
            if (!publicKey) {
                return reply.status(503).send({ error: "Push key is not configured on server" });
            }
            return reply.send({ publicKey });
        }
    );

    app.get(
        "/notifications/stream",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;

            reply.raw.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            });

            const send = (event: string, data: unknown) => {
                reply.raw.write(`event: ${event}\n`);
                reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
            };

            send("connected", { ok: true, at: new Date().toISOString() });

            const unsubscribe = subscribeToNotifications(userId, (payload) => {
                send(payload.event, payload);
            });

            const heartbeat = setInterval(() => {
                send("heartbeat", { at: new Date().toISOString() });
            }, 25_000);

            request.raw.on("close", () => {
                clearInterval(heartbeat);
                unsubscribe();
            });

            return reply.hijack();
        }
    );


    /**
     * GET /notifications
     * ─────────────────────────────────────────────────────────────────────────
     * Get paginated notifications for the current user.
     * Includes actor info (who did it) and optional post info (what they interacted with).
     */
    app.get<{ Querystring: { page?: string; limit?: string } }>(
        "/notifications",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const parsed = NotificationsQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid notification query", details: parsed.error.flatten() });
            }

            const page = Math.max(1, parseInt(parsed.data.page ?? "1", 10));
            const limit = Math.min(50, Math.max(1, parseInt(parsed.data.limit ?? "30", 10)));
            const offset = (page - 1) * limit;

            const [results, unreadCountQuery] = await Promise.all([
                db
                    .select({
                        id: notifications.id,
                        type: notifications.type,
                        isRead: notifications.isRead,
                        actionStatus: notifications.actionStatus,
                        resolvedAt: notifications.resolvedAt,
                        createdAt: notifications.createdAt,
                        actorId: users.id,
                        actorUsername: users.username,
                        actorProfilePic: users.profilePic,
                        postId: posts.id,
                        postContent: posts.content,
                        communityId: communities.id,
                        communitySlug: communities.slug,
                        communityName: communities.name,
                    })
                    .from(notifications)
                    .innerJoin(users, eq(notifications.actorId, users.id))
                    .leftJoin(posts, eq(notifications.postId, posts.id))
                    .leftJoin(communities, eq(notifications.communityId, communities.id))
                    .where(and(eq(notifications.userId, userId), buildViewerBlockFilter(userId, notifications.actorId)))
                    .orderBy(desc(notifications.createdAt))
                    .limit(limit)
                    .offset(offset),
                db.execute<{ count: string }>(sql`
                    SELECT COUNT(*)::text AS count
                    FROM notifications
                    WHERE user_id = ${userId}
                      AND is_read = false
                      AND ${buildViewerBlockFilter(userId, notifications.actorId)}
                `),
            ]);
            const unreadCount = parseInt(unreadCountQuery.rows[0]?.count ?? "0", 10);

            return reply.send({
                notifications: results,
                unreadCount,
                page,
                hasMore: results.length === limit,
            });
        }
    );

    app.patch<{ Params: { id: string } }>(
        "/notifications/:id/resolve",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const body = ResolveNotificationSchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Invalid resolve payload", details: body.error.flatten() });
            }

            const [updated] = await db
                .update(notifications)
                .set({
                    actionStatus: body.data.actionStatus,
                    resolvedAt: new Date(),
                    isRead: true,
                })
                .where(and(eq(notifications.id, request.params.id), eq(notifications.userId, userId)))
                .returning({ id: notifications.id });

            if (!updated) {
                return reply.status(404).send({ error: "Notification not found" });
            }

            publishNotificationEvent({
                event: "notification:read",
                userId,
                at: new Date().toISOString(),
            });

            return reply.send({ success: true });
        }
    );

    /**
     * PATCH /notifications/read
     * ─────────────────────────────────────────────────────────────────────────
     * Submits read receipts. Without ID, marks ALL as read.
     * Optionally takes an array of specific notification IDs.
     */
    app.patch<{ Body: { ids?: string[] } }>(
        "/notifications/read",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const body = MarkReadSchema.safeParse(request.body ?? {});
            if (!body.success) {
                return reply.status(400).send({ error: "Invalid read payload", details: body.error.flatten() });
            }

            const { ids } = body.data;

            if (ids && ids.length > 0) {
                await db
                    .update(notifications)
                    .set({ isRead: true })
                    .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)));
            } else {
                await db
                    .update(notifications)
                    .set({ isRead: true })
                    .where(eq(notifications.userId, userId));
            }

            publishNotificationEvent({
                event: "notification:read",
                userId,
                at: new Date().toISOString(),
            });

            return reply.send({ success: true });
        }
    );

    app.get(
        "/notifications/push-subscriptions",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const members = await app.redis.hvals(`push_subscriptions:${userId}`);
            return reply.send({
                subscriptions: members.map((value) => JSON.parse(value)),
            });
        }
    );

    app.post<{ Body: { endpoint: string; keys: { p256dh: string; auth: string } } }>(
        "/notifications/push-subscriptions",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const body = z.object({
                endpoint: z.string().url(),
                keys: z.object({
                    p256dh: z.string().min(1),
                    auth: z.string().min(1),
                }),
            }).safeParse(request.body);

            if (!body.success) {
                return reply.status(400).send({ error: "Invalid push subscription", details: body.error.flatten() });
            }

            const key = `push_subscriptions:${userId}`;
            const payload = JSON.stringify({
                endpoint: body.data.endpoint,
                keys: body.data.keys,
            });

            await app.redis.hset(key, body.data.endpoint, payload);

            return reply.status(201).send({
                success: true,
                delivery: "stored",
                note: "Subscription stored. Background push is active when VAPID keys are configured.",
            });
        }
    );

    app.delete<{ Body: { endpoint: string } }>(
        "/notifications/push-subscriptions",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const body = z.object({
                endpoint: z.string().url(),
            }).safeParse(request.body);

            if (!body.success) {
                return reply.status(400).send({ error: "Invalid subscription removal payload", details: body.error.flatten() });
            }

            const key = `push_subscriptions:${userId}`;
            await app.redis.hdel(key, body.data.endpoint);

            return reply.send({ success: true });
        }
    );
}
