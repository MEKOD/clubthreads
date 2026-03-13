import { FastifyInstance } from "fastify";
import path from "path";
import fs, { promises as fsp } from "fs";
import { handleMediaUpload, isMediaProcessingOverloadedError } from "../services/media";
import { db } from "../db";
import { posts } from "../db/schema";
import { and, eq } from "drizzle-orm";
import type { AuthRequest } from "../plugins/auth";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
const MAX_FILE_SIZE_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB ?? "15", 10)) * 1024 * 1024;

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function mediaRoutes(app: FastifyInstance) {
    /**
     * POST /media/upload
     * ─────────────────────────────────────────────────────────────────────────
     * Accepts a multipart file upload (images or videos).
     * Processes the file via Sharp (images → WebP) or FFmpeg (video → MP4).
     *
     * Body (multipart/form-data):
     *   file     — the media file
     *   postId   — optional: immediately attach to this post
     *
     * Returns:
     *   { url, mimeType, width?, height?, sizeBytes }
     */
    app.post("/media/upload", { preHandler: app.authenticate }, async (request, reply) => {
        const { userId } = request as AuthRequest;
        const data = await request.file({
            limits: { fileSize: MAX_FILE_SIZE_BYTES },
        });

        if (!data) {
            return reply.status(400).send({ error: "No file uploaded" });
        }

        try {
            const fields = (data as any).fields ?? {};
            const postId = fields.postId?.value as string | undefined;
            if (postId) {
                const [ownedPost] = await db
                    .select({ id: posts.id })
                    .from(posts)
                    .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
                    .limit(1);

                if (!ownedPost) {
                    return reply.status(403).send({ error: "You can only attach media to your own post" });
                }
            }

            const result = await handleMediaUpload(data, UPLOAD_DIR);
            const publicUrl = `/media/${result.filename}`;

            if (postId) {
                await db
                    .update(posts)
                    .set({
                        mediaUrl: publicUrl,
                        mediaMimeType: result.type === "image" ? "image/webp" : "video/mp4",
                        updatedAt: new Date(),
                    })
                    .where(eq(posts.id, postId));
            }

            const response: Record<string, unknown> = {
                url: publicUrl,
                mimeType: result.type === "image" ? "image/webp" : "video/mp4",
                type: result.type,
            };

            if (result.type === "image") {
                response.width = result.processed.width;
                response.height = result.processed.height;
                response.sizeBytes = result.processed.sizeBytes;
            } else {
                response.sizeBytes = result.processed.sizeBytes;
            }

            return reply.status(201).send(response);
        } catch (err: any) {
            app.log.error({ err, filename: data.filename, mimetype: data.mimetype }, "Media upload failed");

            if (err.message?.includes("Unsupported media type")) {
                return reply.status(415).send({ error: err.message });
            }

            if (isMediaProcessingOverloadedError(err)) {
                return reply.status(503).send({
                    error: "Video processing is busy right now",
                    detail: "Sunucu su an fazla sayida video isliyor. Birazdan tekrar dene.",
                });
            }

            // Sharp native module issues (common in Docker)
            if (err.message?.includes("sharp") || err.message?.includes("libvips")) {
                return reply.status(500).send({ error: "Image processing failed — sharp/libvips hata verdi", detail: err.message });
            }

            // FFmpeg not found or crashed
            if (err.message?.includes("FFmpeg") || err.message?.includes("ffmpeg") || err.message?.includes("ENOENT")) {
                return reply.status(500).send({ error: "Video processing failed — ffmpeg hata verdi", detail: err.message });
            }

            // File too large or truncated
            if (err.code === "FST_REQ_FILE_TOO_LARGE") {
                return reply.status(413).send({ error: "Dosya cok buyuk (max 15MB)" });
            }

            return reply.status(500).send({ error: "Media processing failed", detail: err.message ?? String(err) });
        }
    });

    /**
     * GET /media/:filename
     * Serves processed media files from the upload directory.
     * In production, replace this with nginx or Cloudflare R2.
     */
    app.get<{ Params: { filename: string } }>("/media/:filename", async (request, reply) => {
        const { filename } = request.params;

        // Security: prevent directory traversal
        const safeName = path.basename(filename);
        const filePath = path.join(UPLOAD_DIR, safeName);

        let stat: Awaited<ReturnType<typeof fsp.stat>>;
        try {
            stat = await fsp.stat(filePath);
        } catch {
            return reply.status(404).send({ error: "File not found" });
        }

        const ext = path.extname(safeName).toLowerCase();
        const mimeTypes: Record<string, string> = {
            ".webp": "image/webp",
            ".mp4": "video/mp4",
            ".png": "image/png",
        };
        const contentType = mimeTypes[ext] ?? "application/octet-stream";
        const fileSize = stat.size;

        // Handle Range requests (required for video playback)
        const rangeHeader = request.headers.range;
        if (rangeHeader) {
            const parts = rangeHeader.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            return reply
                .status(206)
                .header("Content-Range", `bytes ${start}-${end}/${fileSize}`)
                .header("Accept-Ranges", "bytes")
                .header("Content-Length", chunkSize)
                .header("Content-Type", contentType)
                .header("Cache-Control", "public, max-age=86400, immutable")
                .send(fs.createReadStream(filePath, { start, end }));
        }

        return reply
            .header("Content-Type", contentType)
            .header("Content-Length", fileSize)
            .header("Accept-Ranges", "bytes")
            .header("Cache-Control", "public, max-age=86400, immutable")
            .send(fs.createReadStream(filePath));
    });
}
