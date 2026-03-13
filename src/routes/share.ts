import { FastifyInstance } from "fastify";
import { generateShareCard } from "../services/cardGenerator";

export async function shareRoutes(app: FastifyInstance) {
    /**
     * GET /share/:post_id
     * ─────────────────────────────────────────────────────────────────────────
     * Returns a 1080×1920 PNG share card for the given post.
     * The image is cached in Redis for 1 hour so repeated requests are fast.
     *
     * Example:
     *   curl https://underground.app/share/abc-123 -o card.png
     */
    app.get<{ Params: { post_id: string } }>("/share/:post_id", async (request, reply) => {
        const { post_id } = request.params;

        // Validate UUID format
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_RE.test(post_id)) {
            return reply.status(400).send({ error: "Invalid post ID format" });
        }

        // ── Redis cache check ────────────────────────────────────────────────────
        const redis = app.redis;
        const cacheKey = `share_card:${post_id}`;

        try {
            const cached = await redis.getBuffer(cacheKey);
            if (cached) {
                app.log.info(`[share] Cache HIT for ${post_id}`);
                return reply
                    .header("Content-Type", "image/png")
                    .header("Cache-Control", "public, max-age=3600")
                    .header("X-Cache", "HIT")
                    .send(cached);
            }
        } catch (redisErr) {
            // Redis failure is non-fatal — fall through to generate
            app.log.warn(`[share] Redis error (non-fatal): ${redisErr}`);
        }

        // ── Generate card ────────────────────────────────────────────────────────
        try {
            const pngBuffer = await generateShareCard(post_id);

            // Cache in Redis for 1 hour (60 * 60 = 3600 seconds)
            try {
                await redis.set(cacheKey, pngBuffer, "EX", 3600);
            } catch (cacheErr) {
                app.log.warn(`[share] Failed to cache card: ${cacheErr}`);
            }

            return reply
                .header("Content-Type", "image/png")
                .header("Content-Length", pngBuffer.length.toString())
                .header("Cache-Control", "public, max-age=3600")
                .header("X-Cache", "MISS")
                .send(pngBuffer);
        } catch (err: any) {
            if (err.message?.includes("not found")) {
                return reply.status(404).send({ error: "Post not found" });
            }
            app.log.error(err);
            return reply.status(500).send({ error: "Card generation failed" });
        }
    });
}
