import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { z } from "zod";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import type { AuthRequest } from "../plugins/auth";
import { verifyTurnstileToken } from "../services/turnstile";
import { incrementCounter } from "../services/analytics";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
const USERNAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.AUTH_LOGIN_RATE_LIMIT_MAX ?? "15", 10);
const LOGIN_RATE_LIMIT_WINDOW = process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW ?? "1 minute";
const REGISTER_RATE_LIMIT_MAX = parseInt(process.env.AUTH_REGISTER_RATE_LIMIT_MAX ?? "5", 10);
const REGISTER_RATE_LIMIT_WINDOW = process.env.AUTH_REGISTER_RATE_LIMIT_WINDOW ?? "5 minutes";
const SHARP_INPUT_PIXEL_LIMIT = 40_000_000;

const RegisterSchema = z.object({
    username: z
        .string()
        .min(3)
        .max(32)
        .regex(USERNAME_REGEX, "Sadece harf, rakam, nokta, tire ve alt çizgi kullanılabilir"),
    password: z.string().min(8).max(128),
    bio: z.string().max(500).optional(),
    turnstileToken: z.string().optional(),
});

const LoginSchema = z.object({
    username: z.string().trim().min(1, "Kullanıcı adı zorunlu"),
    password: z.string().min(1, "Şifre zorunlu"),
});

const JsonWebKeySchema = z.object({
    kty: z.string().min(1),
}).passthrough();

const DmCryptoBundleSchema = z.object({
    version: z.literal(1),
    algorithm: z.literal("rsa-oaep-256/aes-gcm-256"),
    publicKey: JsonWebKeySchema,
    encryptedPrivateKey: z.string().trim().min(24).max(20000),
    privateKeyIv: z.string().trim().min(12).max(512),
    privateKeySalt: z.string().trim().min(12).max(512),
});

const UpdateDmCryptoSchema = z.object({
    dmCrypto: DmCryptoBundleSchema,
});

const BCRYPT_ROUNDS = 12;

export async function authRoutes(app: FastifyInstance) {

    /**
     * POST /auth/register
     * Mail yok — anında kayıt. { username, password, bio? }
     */
    app.post("/auth/register", {
        config: {
            rateLimit: {
                max: REGISTER_RATE_LIMIT_MAX,
                timeWindow: REGISTER_RATE_LIMIT_WINDOW,
            },
        },
    }, async (request, reply) => {
        const body = RegisterSchema.safeParse(request.body);
        if (!body.success)
            return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });

        const turnstileResult = await verifyTurnstileToken(request, body.data.turnstileToken);
        if (!turnstileResult.ok) {
            return reply.status(turnstileResult.status).send({ error: turnstileResult.error });
        }

        const { username, password, bio } = body.data;

        const existing = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.username, username.toLowerCase()))
            .limit(1);

        if (existing.length > 0)
            return reply.status(409).send({ error: "Bu kullanıcı adı alınmış" });

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        const [user] = await db
            .insert(users)
            .values({ username: username.toLowerCase(), passwordHash, bio: bio ?? null, role: "user" })
            .returning({ id: users.id, username: users.username, role: users.role, createdAt: users.createdAt, coverPic: users.coverPic, rejectCommunityInvites: users.rejectCommunityInvites });

        const token = app.jwt.sign({ sub: user.id, username: user.username, role: user.role });

        try {
            await incrementCounter(app.redis, "registrations");
        } catch (error) {
            app.log.warn({ err: error }, "Failed to track registration metric");
        }

        return reply.status(201).send({
            token,
            user: { ...user, handle: `@${user.username}` },
            dmCrypto: null,
        });
    });

    /**
     * POST /auth/login
     * { username, password }
     */
    app.post("/auth/login", {
        config: {
            rateLimit: {
                max: LOGIN_RATE_LIMIT_MAX,
                timeWindow: LOGIN_RATE_LIMIT_WINDOW,
            },
        },
    }, async (request, reply) => {
        const body = LoginSchema.safeParse(request.body);
        if (!body.success)
            return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });

        const { username, password } = body.data;

        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.username, username.toLowerCase()))
            .limit(1);

        if (!user || !user.isActive)
            return reply.status(401).send({ error: "Geçersiz kullanıcı adı veya şifre" });

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return reply.status(401).send({ error: "Geçersiz kullanıcı adı veya şifre" });

        const token = app.jwt.sign({ sub: user.id, username: user.username, role: user.role });

        try {
            await incrementCounter(app.redis, "logins");
        } catch (error) {
            app.log.warn({ err: error }, "Failed to track login metric");
        }

        return reply.send({
            token,
            user: {
                id: user.id,
                handle: `@${user.username}`,
                username: user.username,
                role: user.role,
                profilePic: user.profilePic,
                coverPic: user.coverPic,
                bio: user.bio,
                rejectCommunityInvites: user.rejectCommunityInvites,
            },
            dmCrypto: user.dmCrypto ?? null,
        });
    });

    app.get("/auth/me/dm-crypto", { preHandler: app.authenticate }, async (request, reply) => {
        const { userId } = request as AuthRequest;

        const [user] = await db
            .select({ dmCrypto: users.dmCrypto })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) {
            return reply.status(404).send({ error: "Kullanıcı bulunamadı" });
        }

        return reply.send({ dmCrypto: user.dmCrypto ?? null });
    });

    app.post("/auth/me/dm-crypto", { preHandler: app.authenticate }, async (request, reply) => {
        const { userId } = request as AuthRequest;
        const body = UpdateDmCryptoSchema.safeParse(request.body);

        if (!body.success) {
            return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });
        }

        const [updated] = await db
            .update(users)
            .set({
                dmCrypto: body.data.dmCrypto,
                updatedAt: new Date(),
            })
            .where(eq(users.id, userId))
            .returning({ dmCrypto: users.dmCrypto });

        return reply.send({ dmCrypto: updated?.dmCrypto ?? null });
    });

    /**
     * GET /auth/me
     * Mevcut oturumun tam profili.
     */
    app.get("/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
        const { userId } = request as AuthRequest;

        const [user] = await db
            .select({
                id: users.id,
                username: users.username,
                bio: users.bio,
                profilePic: users.profilePic,
                coverPic: users.coverPic,
                rejectCommunityInvites: users.rejectCommunityInvites,
                dmCrypto: users.dmCrypto,
                role: users.role,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) return reply.status(404).send({ error: "Kullanıcı bulunamadı" });

        return reply.send({
            user: {
                id: user.id,
                username: user.username,
                bio: user.bio,
                profilePic: user.profilePic,
                coverPic: user.coverPic,
                rejectCommunityInvites: user.rejectCommunityInvites,
                role: user.role,
                createdAt: user.createdAt,
                handle: `@${user.username}`,
            },
            dmCrypto: user.dmCrypto ?? null,
        });
    });

    /**
     * PATCH /auth/me
     * Profili güncelle: bio, profilePic URL, username.
     * Username değişince yeni JWT imzalanır ve geri döner.
     */
    app.patch("/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
        const { userId } = request as AuthRequest;

        const UpdateSchema = z.object({
            bio: z.string().max(500).optional(),
            profilePic: z.string().url().optional(),
            coverPic: z.string().url().optional(),
            rejectCommunityInvites: z.boolean().optional(),
            username: z
                .string()
                .min(3)
                .max(32)
                .regex(USERNAME_REGEX, "Sadece harf, rakam, nokta, tire ve alt çizgi")
                .optional(),
        });

        const body = UpdateSchema.safeParse(request.body);
        if (!body.success)
            return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });

        const updates: Record<string, unknown> = { updatedAt: new Date() };

        if (body.data.bio !== undefined) updates.bio = body.data.bio;
        if (body.data.profilePic !== undefined) updates.profilePic = body.data.profilePic;
        if (body.data.coverPic !== undefined) updates.coverPic = body.data.coverPic;
        if (body.data.rejectCommunityInvites !== undefined) updates.rejectCommunityInvites = body.data.rejectCommunityInvites;

        let usernameChanged = false;
        if (body.data.username) {
            const newUsername = body.data.username.toLowerCase();

            const [current] = await db
                .select({ username: users.username })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);

            if (current.username !== newUsername) {
                const taken = await db
                    .select({ id: users.id })
                    .from(users)
                    .where(eq(users.username, newUsername))
                    .limit(1);

                if (taken.length > 0)
                    return reply.status(409).send({ error: "Bu kullanıcı adı zaten alınmış" });

                updates.username = newUsername;
                usernameChanged = true;
            }
        }

        const [updated] = await db
            .update(users)
            .set(updates)
            .where(eq(users.id, userId))
            .returning({
                id: users.id,
                username: users.username,
                bio: users.bio,
                profilePic: users.profilePic,
                coverPic: users.coverPic,
                rejectCommunityInvites: users.rejectCommunityInvites,
                role: users.role,
            });

        // Re-sign JWT if username changed (client must replace stored token)
        let newToken: string | null = null;
        if (usernameChanged) {
            newToken = app.jwt.sign({ sub: updated.id, username: updated.username, role: updated.role });
        }

        return reply.send({
            user: { ...updated, handle: `@${updated.username}` },
            token: newToken,
        });
    });

    /**
     * POST /auth/me/avatar
     * ─────────────────────────────────────────────────────────────────────────
     * Profil fotoğrafı yükle (multipart/form-data, field: "file").
     * Sharp ile 512×512 kare kırpma, WebP dönüşümü, EXIF silme.
     * Dönen URL profilPic olarak kaydedilir.
     */
    app.post("/auth/me/avatar", { preHandler: app.authenticate }, async (request, reply) => {
        const { userId } = request as AuthRequest;

        const data = await request.file({ limits: { fileSize: 5 * 1024 * 1024 } }); // 5 MB
        if (!data) return reply.status(400).send({ error: "Dosya bulunamadı" });

        if (!data.mimetype.startsWith("image/"))
            return reply.status(415).send({ error: "Sadece resim dosyası yüklenebilir" });

        try {
            const inputBuffer = await data.toBuffer();

            const sharp = (await import("sharp")).default;

            const processed = await sharp(inputBuffer, { limitInputPixels: SHARP_INPUT_PIXEL_LIMIT })
                .rotate()                           // EXIF yönünü düzelt
                .resize(512, 512, {
                    fit: "cover",               // kare kırp
                    position: "attention",           // akıllı odak noktası
                })
                .webp({ quality: 85 })
                .toBuffer();

            if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

            const filename = `avatar_${userId}_${Date.now()}.webp`;
            const destPath = path.join(UPLOAD_DIR, filename);
            fs.writeFileSync(destPath, processed);

            const publicUrl = `/media/${filename}`;

            const [updated] = await db
                .update(users)
                .set({ profilePic: publicUrl, updatedAt: new Date() })
                .where(eq(users.id, userId))
                .returning({ id: users.id, username: users.username, profilePic: users.profilePic });

            return reply.send({ profilePic: updated.profilePic });
        } catch (err) {
            app.log.error(err);
            return reply.status(500).send({ error: "Avatar işlenemedi" });
        }
    });

    /**
     * POST /auth/me/cover
     * Cover görseli yükle (multipart/form-data, field: "file").
     * 1500x500 webp olarak optimize edilir.
     */
    app.post("/auth/me/cover", { preHandler: app.authenticate }, async (request, reply) => {
        const { userId } = request as AuthRequest;

        const data = await request.file({ limits: { fileSize: 8 * 1024 * 1024 } }); // 8 MB
        if (!data) return reply.status(400).send({ error: "Dosya bulunamadı" });

        if (!data.mimetype.startsWith("image/"))
            return reply.status(415).send({ error: "Sadece resim dosyası yüklenebilir" });

        try {
            const inputBuffer = await data.toBuffer();
            const sharp = (await import("sharp")).default;

            const processed = await sharp(inputBuffer, { limitInputPixels: SHARP_INPUT_PIXEL_LIMIT })
                .rotate()
                .resize(1500, 500, {
                    fit: "cover",
                    position: "attention",
                })
                .webp({ quality: 84 })
                .toBuffer();

            if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

            const filename = `cover_${userId}_${Date.now()}.webp`;
            const destPath = path.join(UPLOAD_DIR, filename);
            fs.writeFileSync(destPath, processed);

            const publicUrl = `/media/${filename}`;

            const [updated] = await db
                .update(users)
                .set({ coverPic: publicUrl, updatedAt: new Date() })
                .where(eq(users.id, userId))
                .returning({ id: users.id, username: users.username, coverPic: users.coverPic });

            return reply.send({ coverPic: updated.coverPic });
        } catch (err) {
            app.log.error(err);
            return reply.status(500).send({ error: "Kapak görseli işlenemedi" });
        }
    });
}
