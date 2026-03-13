import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import * as os from "os";
import { promisify } from "util";
import { pipeline } from "stream";
import { randomUUID } from "crypto";
import type { MultipartFile } from "@fastify/multipart";

const streamPipeline = promisify(pipeline);

const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 40_000_000;
const WEBP_QUALITY = 82;
const VIDEO_TRANSCODE_CONCURRENCY = Math.min(
    Math.max(parseInt(process.env.VIDEO_TRANSCODE_CONCURRENCY ?? "1", 10), 1),
    2
);
const VIDEO_TRANSCODE_QUEUE_LIMIT = Math.max(parseInt(process.env.VIDEO_TRANSCODE_QUEUE_LIMIT ?? "4", 10), 0);

class MediaProcessingOverloadedError extends Error {
    code = "MEDIA_PROCESSING_OVERLOADED";
    constructor(message: string) {
        super(message);
        this.name = "MediaProcessingOverloadedError";
    }
}

let activeVideoJobs = 0;
const pendingVideoJobs: Array<() => void> = [];

async function withVideoProcessingSlot<T>(task: () => Promise<T>): Promise<T> {
    if (activeVideoJobs >= VIDEO_TRANSCODE_CONCURRENCY) {
        if (pendingVideoJobs.length >= VIDEO_TRANSCODE_QUEUE_LIMIT) {
            throw new MediaProcessingOverloadedError("Video processing queue is full");
        }

        await new Promise<void>((resolve) => {
            pendingVideoJobs.push(resolve);
        });
    }

    activeVideoJobs += 1;
    try {
        return await task();
    } finally {
        activeVideoJobs -= 1;
        const next = pendingVideoJobs.shift();
        if (next) next();
    }
}

export interface ProcessedImage {
    mimeType: "image/webp";
    width: number;
    height: number;
    sizeBytes: number;
}

export interface ProcessedVideo {
    outputPath: string;
    posterPath: string;
    mimeType: "video/mp4";
    sizeBytes: number;
}

function createVideoPoster(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .inputOptions(["-ss 0.35"])
            .frames(1)
            .outputOptions(["-vf scale='min(720,iw)':-2"])
            .on("end", () => resolve())
            .on("error", (err) => reject(new Error(`FFmpeg poster error: ${err.message}`)))
            .save(outputPath);
    });
}

export async function processImage(input: string, outputPath: string): Promise<ProcessedImage> {
    const image = sharp(input, { failOn: "truncated", limitInputPixels: MAX_IMAGE_PIXELS });
    const meta = await image.metadata();
    const originalWidth = meta.width ?? 1920;
    const originalHeight = meta.height ?? 1080;

    const processed = (originalWidth > MAX_IMAGE_DIMENSION || originalHeight > MAX_IMAGE_DIMENSION)
        ? image.resize({
            width: MAX_IMAGE_DIMENSION,
            height: MAX_IMAGE_DIMENSION,
            fit: "inside",
            withoutEnlargement: true,
        })
        : image;

    const info = await processed
        .rotate()
        .webp({ quality: WEBP_QUALITY, smartSubsample: true })
        .toFile(outputPath);

    return {
        mimeType: "image/webp" as const,
        width: info.width,
        height: info.height,
        sizeBytes: info.size,
    };
}

export function processVideo(inputPath: string, outputPath: string, posterPath: string): Promise<ProcessedVideo> {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .videoCodec("libx264")
            .audioCodec("aac")
            .audioBitrate("128k")
            .audioFrequency(44100)
            .outputOptions([
                "-crf 26",
                "-preset fast",
                "-profile:v baseline",
                "-level 3.1",
                "-pix_fmt yuv420p",
                "-ac 2",
                "-vf scale='min(720,iw)':-2",
                "-movflags +faststart",
                "-map_metadata -1",
            ])
            .on("end", async () => {
                try {
                    await createVideoPoster(outputPath, posterPath);
                    const stats = await fsp.stat(outputPath);
                    resolve({ outputPath, posterPath, mimeType: "video/mp4", sizeBytes: stats.size });
                } catch (err: any) {
                    reject(new Error(`FFmpeg output stat failed: ${err.message}`));
                }
            })
            .on("error", (err) => {
                reject(new Error(`FFmpeg error: ${err.message}`));
            })
            .save(outputPath);
    });
}

export type MediaType = "image" | "video" | "unsupported";

export function detectMediaType(mimeType: string): MediaType {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    return "unsupported";
}

export function isMediaProcessingOverloadedError(error: unknown): boolean {
    return error instanceof MediaProcessingOverloadedError
        || (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "MEDIA_PROCESSING_OVERLOADED");
}

export async function handleMediaUpload(
    file: MultipartFile,
    uploadDir: string
): Promise<
    | { type: "image"; processed: ProcessedImage; filename: string }
    | { type: "video"; processed: ProcessedVideo; filename: string }
> {
    const mediaType = detectMediaType(file.mimetype);
    if (mediaType === "unsupported") {
        throw new Error(`Unsupported media type: ${file.mimetype}`);
    }

    await fsp.mkdir(uploadDir, { recursive: true });

    const safeBaseName = path.basename(file.filename, path.extname(file.filename)).replace(/[^a-zA-Z0-9_-]/g, "_");
    const tempPath = path.join(os.tmpdir(), `upload_${randomUUID()}_${safeBaseName}${path.extname(file.filename)}`);

    await streamPipeline(file.file, fs.createWriteStream(tempPath));

    try {
        if (mediaType === "image") {
            const filename = `${Date.now()}_${randomUUID()}_${safeBaseName}.webp`;
            const destPath = path.join(uploadDir, filename);
            const processed = await processImage(tempPath, destPath);
            return { type: "image", processed, filename };
        }

        const filename = `${Date.now()}_${randomUUID()}_${safeBaseName}_opt.mp4`;
        const posterFilename = filename.replace(/_opt\.mp4$/, "_poster.png");
        const destPath = path.join(uploadDir, filename);
        const posterDestPath = path.join(uploadDir, posterFilename);
        const processed = await withVideoProcessingSlot(() => processVideo(tempPath, destPath, posterDestPath));
        return { type: "video", processed: { ...processed, outputPath: destPath, posterPath: posterDestPath }, filename };
    } finally {
        await Promise.allSettled([
            fsp.unlink(tempPath).catch(() => { }),
        ]);
    }
}
