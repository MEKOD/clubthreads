import "dotenv/config";
import app from "./app";
import { checkDbHealth } from "./db";
import { db } from "./db";
import { users } from "./db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { createMonitoringServer } from "./monitoring";
import { ensureAiBotUser } from "./services/aiBot";
import { getSeedAdminConfig, listAllowedCorsOrigins } from "./config/security";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const MONITORING_PORT = parseInt(process.env.MONITORING_PORT ?? "3100", 10);
const MONITORING_HOST = process.env.MONITORING_HOST ?? "127.0.0.1";
const ENABLE_LOCAL_MONITORING = process.env.ENABLE_LOCAL_MONITORING !== "false";

let monitoringServer: ReturnType<typeof createMonitoringServer> | null = null;

async function seedAdmin() {
    const seedConfig = getSeedAdminConfig();
    if (!seedConfig) {
        return;
    }

    const [existing] = await db.select().from(users).where(eq(users.username, seedConfig.username)).limit(1);

    if (!existing) {
        const passwordHash = await bcrypt.hash(seedConfig.password, 12);
        await db.insert(users).values({
            username: seedConfig.username,
            passwordHash,
            role: "admin",
            bio: "Kurucu / Sistem Yöneticisi",
            isActive: true,
        });
        console.log(`\n[startup] Seed admin account created for @${seedConfig.username}`);
        return;
    }

    if (existing.role === "admin") {
        console.log(`\n[startup] Seed admin account already present for @${seedConfig.username}`);
        return;
    }

    console.warn(`\n[startup] User @${seedConfig.username} already exists with role "${existing.role}". Skipping auto-promotion.`);
}

async function start() {
    try {
        // Verify DB connection before accepting traffic
        await checkDbHealth();

        // Seed default admin account
        await seedAdmin();
        await ensureAiBotUser();

        await app.listen({ port: PORT, host: HOST });

        if (ENABLE_LOCAL_MONITORING) {
            monitoringServer = createMonitoringServer(app.redis);
            await monitoringServer.listen({ port: MONITORING_PORT, host: MONITORING_HOST });
        }

        console.log(`\n🚀 Underground Social API running at http://${HOST}:${PORT}`);
        console.log(`📊 Decay feed: http://${HOST}:${PORT}/feed`);
        console.log(`🃏 Share cards: http://${HOST}:${PORT}/share/:post_id`);
        console.log(`🖼  Media upload: POST http://${HOST}:${PORT}/media/upload`);
        console.log(`❤  Health check: http://${HOST}:${PORT}/health\n`);
        const allowedCorsOrigins = listAllowedCorsOrigins();
        if (allowedCorsOrigins.length > 0) {
            console.log(`[startup] Allowed browser origins: ${allowedCorsOrigins.join(", ")}`);
        } else if (process.env.NODE_ENV === "production") {
            console.warn("[startup] No cross-origin browser origins are allowed. Set CORS_ALLOWED_ORIGINS or APP_ORIGIN if the frontend is hosted separately.");
        }
        if (ENABLE_LOCAL_MONITORING) {
            console.log(`🛰  Local monitoring: http://${MONITORING_HOST}:${MONITORING_PORT}`);
        }
    } catch (err) {
        console.error("[startup] Fatal error:", err);
        process.exit(1);
    }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
signals.forEach((signal) => {
    process.once(signal, async () => {
        console.log(`\n[shutdown] Received ${signal}, closing gracefully…`);
        try {
            if (monitoringServer) {
                await monitoringServer.close();
            }
            await app.close();
            console.log("[shutdown] Server closed. Bye! 👋");
            process.exit(0);
        } catch (err) {
            console.error("[shutdown] Error during close:", err);
            process.exit(1);
        }
    });
});

start();
