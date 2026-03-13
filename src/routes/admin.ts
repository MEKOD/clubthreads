import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db";
import { users } from "../db/schema";
import { asc, eq, ilike, or } from "drizzle-orm";
import type { AuthRequest } from "../plugins/auth";
import { sendReengagementPushes } from "../services/webPush";
import { getVisitorAnalyticsReport } from "../services/visitorAnalytics";

const RoleUpdateSchema = z.object({
    role: z.enum(["user", "pink", "elite", "admin"]),
});

const ReengagementSchema = z.object({
    limit: z.number().int().min(1).max(500).optional(),
    minHoursSinceLastUnread: z.number().int().min(1).max(168).optional(),
    cooldownHours: z.number().int().min(1).max(168).optional(),
    dryRun: z.boolean().optional(),
});

const VisitorAnalyticsQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(30).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});

function hasAdminAccess(request: AuthRequest): boolean {
    return request.userRole === "admin";
}

export async function adminRoutes(app: FastifyInstance) {
    app.get<{ Querystring: { days?: string; limit?: string } }>(
        "/admin/analytics/visitors",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const auth = request as AuthRequest;
            if (!hasAdminAccess(auth)) {
                return reply.status(403).send({ error: "Forbidden: Yalnızca admin erişebilir" });
            }

            const parsed = VisitorAnalyticsQuerySchema.safeParse(request.query ?? {});
            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid analytics query", details: parsed.error.flatten() });
            }

            const report = await getVisitorAnalyticsReport({
                days: parsed.data.days,
                limit: parsed.data.limit,
            });

            return reply.send(report);
        }
    );

    app.get<{ Querystring: { q?: string; limit?: string } }>(
        "/admin/users",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userRole } = request as AuthRequest;
            if (userRole !== "admin") {
                return reply.status(403).send({ error: "Forbidden: Yalnızca admin erişebilir" });
            }

            const q = (request.query.q ?? "").trim().toLowerCase();
            const limit = Math.min(50, Math.max(1, parseInt(request.query.limit ?? "20", 10)));

            const result = await db
                .select({
                    id: users.id,
                    username: users.username,
                    profilePic: users.profilePic,
                    role: users.role,
                    isActive: users.isActive,
                    createdAt: users.createdAt,
                })
                .from(users)
                .where(
                    q
                        ? or(
                            ilike(users.username, `${q}%`),
                            ilike(users.bio, `%${q}%`)
                        )
                        : undefined
                )
                .orderBy(asc(users.username))
                .limit(limit);

            return reply.send({ users: result });
        }
    );

    /**
     * PATCH /admin/users/:username/role
     * Grant 'pink', 'elite', 'admin' or revoke to 'user' role. Only for admins.
     */
    app.patch<{ Params: { username: string } }>(
        "/admin/users/:username/role",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userRole } = request as AuthRequest;
            const { username } = request.params;

            // Strict admin check
            if (userRole !== "admin") {
                return reply.status(403).send({ error: "Forbidden: Yalnızca yetkili yöneticiler kullanabilir" });
            }

            const body = RoleUpdateSchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Validation failed: role must be user, pink, elite or admin" });
            }

            const { role } = body.data;
            const targetUsername = username.toLowerCase();

            const [user] = await db
                .update(users)
                .set({ role, updatedAt: new Date() })
                .where(eq(users.username, targetUsername))
                .returning({ username: users.username, role: users.role });

            if (!user) {
                return reply.status(404).send({ error: "Kullanıcı bulunamadı" });
            }

            return reply.send({ success: true, user });
        }
    );

    app.patch<{ Params: { username: string } }>(
        "/admin/users/:username/elite",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userRole } = request as AuthRequest;
            if (userRole !== "admin") {
                return reply.status(403).send({ error: "Forbidden: Yalnızca admin erişebilir" });
            }

            const [user] = await db
                .update(users)
                .set({ role: "elite", updatedAt: new Date() })
                .where(eq(users.username, request.params.username.toLowerCase()))
                .returning({ username: users.username, role: users.role });

            if (!user) return reply.status(404).send({ error: "Kullanıcı bulunamadı" });

            return reply.send({ success: true, user });
        }
    );

    app.post<{ Body: { limit?: number; minHoursSinceLastUnread?: number; cooldownHours?: number; dryRun?: boolean } }>(
        "/admin/notifications/reengage",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userRole } = request as AuthRequest;
            if (userRole !== "admin") {
                return reply.status(403).send({ error: "Forbidden: Yalnızca admin erişebilir" });
            }

            const body = ReengagementSchema.safeParse(request.body ?? {});
            if (!body.success) {
                return reply.status(400).send({ error: "Invalid reengagement payload", details: body.error.flatten() });
            }

            const result = await sendReengagementPushes({
                redis: app.redis,
                logger: app.log,
                limit: body.data.limit,
                minHoursSinceLastUnread: body.data.minHoursSinceLastUnread,
                cooldownHours: body.data.cooldownHours,
                dryRun: body.data.dryRun,
            });

            return reply.send({ success: true, result });
        }
    );
}
