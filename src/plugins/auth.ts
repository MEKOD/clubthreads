import { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";

/**
 * JWT Auth Plugin
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers `fastifyJwt` on the Fastify instance and exposes two decorators:
 *   - `app.authenticate`  → throws 401 if token is missing/invalid
 *   - `app.optionalAuth`  → attaches userId if token present, continues anyway
 *
 * Usage in routes:
 *   app.get("/", { preHandler: app.authenticate }, handler)
 *   app.get("/", { preHandler: app.optionalAuth },  handler)
 *
 * After authentication, the user's UUID is available as:
 *   (request as AuthRequest).userId
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { eq } from "drizzle-orm";
import { getJwtSecret } from "../config/security";
import { db } from "../db";
import { users } from "../db/schema";

export interface JwtPayload {
    sub: string;   // user UUID
    username: string;
    role: "admin" | "elite" | "pink" | "user";
}

export interface AuthRequest extends FastifyRequest {
    userId: string;
    userRole: "admin" | "elite" | "pink" | "user";
    username: string;
}

class SessionUnauthorizedError extends Error {
    code = "SESSION_UNAUTHORIZED";
}

function isAuthenticationFailure(error: unknown) {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return false;
    }

    const code = String((error as { code?: string }).code ?? "");
    return code === "SESSION_UNAUTHORIZED" || code.startsWith("FST_JWT_");
}

export default fp(async function authPlugin(app: FastifyInstance) {
    app.register(fastifyJwt, {
        secret: getJwtSecret(app.log),
        sign: {
            expiresIn: "7d",
        },
    });

    async function attachAuthenticatedUser(request: FastifyRequest) {
        const payload = await request.jwtVerify<JwtPayload>();
        const [user] = await db
            .select({
                id: users.id,
                username: users.username,
                role: users.role,
                isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.id, payload.sub))
            .limit(1);

        if (!user || !user.isActive) {
            throw new SessionUnauthorizedError("Unauthorized");
        }

        (request as AuthRequest).userId = user.id;
        (request as AuthRequest).userRole = user.role;
        (request as AuthRequest).username = user.username;
    }

    // ── Hard authenticate: reject if no valid token ────────────────────────────
    app.decorate(
        "authenticate",
        async function (request: FastifyRequest, reply: FastifyReply) {
            try {
                await attachAuthenticatedUser(request);
            } catch (error) {
                if (!isAuthenticationFailure(error)) {
                    app.log.error({ err: error }, "Authentication lookup failed");
                    return reply.status(503).send({ error: "Authentication service unavailable" });
                }
                return reply.status(401).send({ error: "Unauthorized" });
            }
        }
    );

    // ── Optional auth: attach user if token present, don't block otherwise ──────
    app.decorate(
        "optionalAuth",
        async function (request: FastifyRequest, _reply: FastifyReply) {
            try {
                await attachAuthenticatedUser(request);
            } catch (error) {
                if (!isAuthenticationFailure(error)) {
                    throw error;
                }
                // Token absent or invalid — that's fine for optional auth
            }
        }
    );
});

// TypeScript augmentation so `app.authenticate` and `app.optionalAuth`
// are known to the compiler throughout the codebase.
declare module "fastify" {
    interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}
