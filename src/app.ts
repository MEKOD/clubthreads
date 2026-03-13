import Fastify from "fastify";
import fastifyRedis from "@fastify/redis";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import authPlugin from "./plugins/auth";
import { isAllowedCorsOrigin } from "./config/security";

// ─── Route imports ────────────────────────────────────────────────────────────
import { authRoutes } from "./routes/auth";
import { feedRoutes } from "./routes/feed";
import { postsRoutes } from "./routes/posts";
import { interactionRoutes } from "./routes/interactions";
import { followRoutes } from "./routes/follows";
import { communityRoutes } from "./routes/communities";
import { usersRoutes } from "./routes/users";
import { trendingRoutes } from "./routes/trending";
import { shareRoutes } from "./routes/share";
import { mediaRoutes } from "./routes/media";
import { notificationsRoutes } from "./routes/notifications";
import { adminRoutes } from "./routes/admin";
import { analyticsRoutes } from "./routes/analytics";
import { directMessageRoutes } from "./routes/directMessages";
import { payloadFromDirectMessageEvent, payloadFromNotificationEvent, sendWebPushToUser } from "./services/webPush";
import { setNotificationPushDispatcher } from "./services/notificationHub";
import { setDirectMessagePushDispatcher, startDirectMessageHub, stopDirectMessageHub } from "./services/directMessageHub";
import { incrementCounter, trackRouteMetric } from "./services/analytics";
import type Redis from "ioredis";

// ─── Fastify Instance ─────────────────────────────────────────────────────────
const app = Fastify({
    logger: {
        level: process.env.NODE_ENV === "production" ? "warn" : "info",
        transport:
            process.env.NODE_ENV !== "production"
                ? { target: "pino-pretty", options: { colorize: true } }
                : undefined,
    },
    trustProxy: true,  // Cloudflare Tunnel / reverse proxy
    maxParamLength: 1000, // Important for long video filenames
});

// ─── Plugins ──────────────────────────────────────────────────────────────────

app.register(cors, {
    origin(origin, callback) {
        callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    exposedHeaders: ["Content-Length", "Content-Range"],
});

app.register(authPlugin);   // JWT — must come before routes that use app.authenticate

app.register(fastifyRedis, {
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
    closeClient: true,
});

app.addHook("onRequest", async (request) => {
    (request as typeof request & { startedAt?: number }).startedAt = Date.now();
});

app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), geolocation=(), microphone=()");

    if (request.protocol === "https") {
        reply.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }

    return payload;
});

app.addHook("onResponse", async (request, reply) => {
    const startedAt = (request as typeof request & { startedAt?: number }).startedAt ?? Date.now();
    const latencyMs = Date.now() - startedAt;
    const routeUrl = request.routeOptions.url || request.routerPath || request.url;

    try {
        await trackRouteMetric(app.redis, {
            route: `${request.method} ${routeUrl}`,
            latencyMs,
            statusCode: reply.statusCode,
        });
    } catch (error) {
        app.log.warn({ err: error }, "Failed to track route metric");
    }
});

app.after(() => {
    setNotificationPushDispatcher(async (event) => {
        if (event.event !== "notification:new") return;
        try {
            await incrementCounter(app.redis, "notifications_emitted");
        } catch (error) {
            app.log.warn({ err: error }, "Failed to track notification metric");
        }
        await sendWebPushToUser(
            app.redis,
            event.userId,
            payloadFromNotificationEvent({
                notificationType: event.notificationType,
                postId: event.postId,
                communitySlug: event.communitySlug,
                actorId: event.actorId,
                at: event.at,
            }),
            app.log
        );
    });

    const subscriber = (app.redis as Redis).duplicate();

    void startDirectMessageHub({
        publisher: app.redis as unknown as Redis,
        subscriber,
        logger: app.log,
    }).catch((error) => {
        app.log.error({ err: error }, "Failed to start direct message hub");
    });

    setDirectMessagePushDispatcher(async (event) => {
        if (event.event !== "dm:new") return;

        try {
            await incrementCounter(app.redis, "dm_events_emitted");
        } catch (error) {
            app.log.warn({ err: error }, "Failed to track DM metric");
        }

        await sendWebPushToUser(
            app.redis,
            event.userId,
            payloadFromDirectMessageEvent({
                senderUsername: event.senderUsername,
                counterpartyUsername: event.counterpartyUsername,
                previewText: event.previewText,
                at: event.at,
            }),
            app.log
        );
    });
});

app.addHook("onClose", async () => {
    await stopDirectMessageHub();
});

app.register(fastifyMultipart, {
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE_MB ?? "20", 10) * 1024 * 1024,
        files: 1,
    },
});

app.register(fastifyRateLimit, {
    global: true,
    max: parseInt(process.env.RATE_LIMIT_MAX ?? "300", 10),
    timeWindow: "1 minute",
    keyGenerator: (req) =>
        (req.headers["cf-connecting-ip"] as string) ?? req.ip,
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// Auth
app.register(authRoutes);          // POST /auth/register|login, GET+PATCH /auth/me, POST /auth/me/avatar

// Core social
app.register(feedRoutes);          // GET /feed, GET /feed/post/:id
app.register(postsRoutes);         // POST /posts, GET+DELETE /posts/:id
app.register(interactionRoutes);   // POST /posts/:id/interact, GET /posts/:id/interactions
app.register(followRoutes);        // POST+DELETE /users/:username/follow, followers/following list
app.register(usersRoutes);         // GET /users/:username (full profile), GET /search/users
app.register(trendingRoutes);      // GET /trending, /trending/rising, /trending/weekly, /search/posts
app.register(communityRoutes);     // CRUD /communities, join/leave, post tagging
app.register(notificationsRoutes); // GET /notifications, PATCH /notifications/read
app.register(directMessageRoutes); // GET /dm/*, POST /dm/conversations, POST /dm/conversations/:id/messages
app.register(adminRoutes);         // PATCH /admin/users/:username/role
app.register(analyticsRoutes);     // POST /analytics/batch

// Media
app.register(shareRoutes);         // GET /share/:post_id  → PNG share card
app.register(mediaRoutes);         // POST /media/upload, GET /media/:filename

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", async (_, reply) =>
    reply.send({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() })
);

// ─── Error handlers ───────────────────────────────────────────────────────────
app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, url: request.url });
    const code = error.statusCode ?? 500;
    if (code === 429) {
        const isRegisterAttempt = request.url.startsWith("/auth/register");
        return reply.status(429).send({
            error: isRegisterAttempt
                ? "Bu IP adresi icin hesap olusturma sinirina ulasildi. 5 dakika sonra tekrar dene."
                : "Cok fazla istek gonderdin. Lutfen biraz bekleyip tekrar dene.",
        });
    }

    reply.status(code).send({ error: code === 500 ? "Internal Server Error" : error.message });
});

app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: `Route not found: ${request.method} ${request.url}` })
);

export default app;
