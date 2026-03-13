import { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthRequest } from "../plugins/auth";
import { behavioralEntityTypes, behavioralEventTypes, persistBehaviorBatch, trackBehaviorBatch } from "../services/analytics";
import { buildVisitorAnalyticsContext } from "../services/visitorAnalytics";

const AnalyticsEventSchema = z.object({
    eventType: z.enum(behavioralEventTypes),
    surface: z.string().trim().min(1).max(80),
    entityType: z.enum(behavioralEntityTypes).optional(),
    entityId: z.string().trim().min(1).max(120).optional(),
    sessionId: z.string().trim().min(8).max(80).optional(),
    dwellMs: z.number().int().min(0).max(300_000).optional(),
    searchQuery: z.string().trim().min(2).max(160).optional(),
    at: z.string().datetime().optional(),
}).superRefine((value, ctx) => {
    if (value.entityType && !value.entityId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "entityId is required when entityType is provided",
            path: ["entityId"],
        });
    }
});

const AnalyticsBatchSchema = z.object({
    events: z.array(AnalyticsEventSchema).min(1).max(100),
});

export async function analyticsRoutes(app: FastifyInstance) {
    app.post(
        "/analytics/batch",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const parsed = AnalyticsBatchSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid analytics batch", details: parsed.error.flatten() });
            }

            const visitorContext = buildVisitorAnalyticsContext(request);
            const enrichedEvents = parsed.data.events.map((event) => ({
                ...event,
                visitorContext,
            }));

            await persistBehaviorBatch(userId, enrichedEvents);

            try {
                await trackBehaviorBatch(app.redis, userId, enrichedEvents);
            } catch (error) {
                app.log.warn({ err: error, userId, count: parsed.data.events.length }, "Failed to mirror analytics batch to Redis");
            }

            return reply.status(202).send({
                accepted: parsed.data.events.length,
            });
        }
    );
}
