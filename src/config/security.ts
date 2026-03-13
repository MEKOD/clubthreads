import { randomBytes } from "node:crypto";

const MIN_JWT_SECRET_LENGTH = 32;
const USERNAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const DEV_CORS_ORIGINS = [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
];

let cachedJwtSecret: string | null = null;

function isProduction() {
    return process.env.NODE_ENV === "production";
}

function normalizeOrigin(origin: string) {
    try {
        return new URL(origin).origin;
    } catch {
        return null;
    }
}

function collectConfiguredOrigins() {
    const configuredValues = [
        process.env.CORS_ALLOWED_ORIGINS ?? "",
        process.env.APP_ORIGIN ?? "",
        process.env.FRONTEND_ORIGIN ?? "",
    ];

    const origins = new Set<string>();

    for (const value of configuredValues) {
        for (const entry of value.split(",")) {
            const normalized = normalizeOrigin(entry.trim());
            if (normalized) {
                origins.add(normalized);
            }
        }
    }

    if (!isProduction()) {
        for (const origin of DEV_CORS_ORIGINS) {
            origins.add(origin);
        }
    }

    return origins;
}

export function listAllowedCorsOrigins() {
    return [...collectConfiguredOrigins()].sort();
}

export function isAllowedCorsOrigin(origin?: string | null) {
    if (!origin) {
        return true;
    }

    const normalized = normalizeOrigin(origin);
    if (!normalized) {
        return false;
    }

    return collectConfiguredOrigins().has(normalized);
}

export function getJwtSecret(logger?: { warn: (...args: unknown[]) => void }) {
    if (cachedJwtSecret) {
        return cachedJwtSecret;
    }

    const configuredSecret = process.env.JWT_SECRET?.trim();
    if (configuredSecret) {
        if (configuredSecret.length < MIN_JWT_SECRET_LENGTH) {
            throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long`);
        }

        cachedJwtSecret = configuredSecret;
        return cachedJwtSecret;
    }

    if (isProduction()) {
        throw new Error("JWT_SECRET must be set in production");
    }

    cachedJwtSecret = randomBytes(32).toString("hex");
    logger?.warn("JWT_SECRET is not set; using an ephemeral development secret");
    return cachedJwtSecret;
}

export function getSeedAdminConfig() {
    if (process.env.SEED_ADMIN_ON_STARTUP !== "true") {
        return null;
    }

    const username = process.env.SEED_ADMIN_USERNAME?.trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD?.trim();

    if (!username || !password) {
        throw new Error("SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD are required when SEED_ADMIN_ON_STARTUP=true");
    }

    if (username.length < 3 || username.length > 32 || !USERNAME_REGEX.test(username)) {
        throw new Error("SEED_ADMIN_USERNAME must be 3-32 chars and contain only letters, numbers, dots, dashes or underscores");
    }

    if (password.length < 12) {
        throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters long");
    }

    return { username, password };
}
