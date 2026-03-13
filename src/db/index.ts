import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// ─── Connection Pool ─────────────────────────────────────────────────────────
// Fine-tuned for small-to-medium social workloads.
// Scale `max` based on server RAM: rule of thumb = (CPU cores * 2) + disk spindles
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,              // max connections in pool
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Enable SSL in production only (DATABASE_URL handles sslmode parameter)
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: true }
        : undefined,
});

pool.on("error", (err) => {
    console.error("[pg-pool] Unexpected error on idle client:", err);
    process.exit(1);
});

// ─── Drizzle Instance ────────────────────────────────────────────────────────
export const db = drizzle(pool, {
    schema,
    logger: process.env.NODE_ENV === "development",
});

// ─── Health Check ────────────────────────────────────────────────────────────
export async function checkDbHealth(): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query("SELECT 1");
        console.log("[db] PostgreSQL connection OK");
    } finally {
        client.release();
    }
}

export { pool };
export type Db = typeof db;
