import satori, { type Font as SatoriFont } from "satori";
import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import { db } from "../db";
import { posts, users } from "../db/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import * as https from "https";
import { randomUUID } from "crypto";

// ─── Font Setup ──────────────────────────────────────────────────────────────
// Fonts are loaded once at module import time for performance.
// Place your font files in src/assets/fonts/
const FONTS_DIR = path.join(__dirname, "..", "assets", "fonts");

function loadFont(filename: string): Buffer | null {
    const fontPath = path.join(FONTS_DIR, filename);
    if (fs.existsSync(fontPath)) return fs.readFileSync(fontPath);
    console.warn(`[cardGen] Font not found: ${fontPath}. Download Inter from Google Fonts.`);
    return null;
}

const interRegular = loadFont("Inter-Regular.ttf");
const interBold = loadFont("Inter-Bold.ttf");
const interBlack = loadFont("Inter-Black.ttf");

const SATORI_FONTS: SatoriFont[] = [];
if (interRegular) SATORI_FONTS.push({ name: "Inter", data: interRegular, weight: 400, style: "normal" });
if (interBold) SATORI_FONTS.push({ name: "Inter", data: interBold, weight: 700, style: "normal" });
if (interBlack) SATORI_FONTS.push({ name: "Inter", data: interBlack, weight: 900, style: "normal" });

// ─── Card Dimensions ─────────────────────────────────────────────────────────
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;
const SHARE_DOMAIN = "club.misya.me";
const DEFAULT_ASSET_ORIGIN = `https://${SHARE_DOMAIN}`;

// ─── Types ───────────────────────────────────────────────────────────────────
interface CardPost {
    content: string | null;
    createdAt: Date;
    favCount: number;
    trashCount: number;
    rtCount: number;
    authorUsername: string;
    authorProfilePic: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
}

interface CardMediaPreview {
    dataUrl: string;
    isVideo: boolean;
}

// ─── JSX-free React element builder ─────────────────────────────────────────
// Satori accepts React-like element trees without needing JSX compilation.
function h(
    type: string,
    props: Record<string, unknown> | null,
    ...children: unknown[]
): object {
    return { type, props: { ...props, children: children.flat() } };
}

// ─── Card Layout ─────────────────────────────────────────────────────────────
function buildCardElement(post: CardPost, mediaPreview: CardMediaPreview | null, avatarDataUrl: string | null): object {
    const date = new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Istanbul",
    }).format(new Date(post.createdAt));

    const avatarLetter = post.authorUsername.charAt(0).toUpperCase();
    const postBody = (post.content ?? "").trim();
    const hasMedia = Boolean(mediaPreview);
    const hasText = postBody.length > 0;

    return h(
        "div",
        {
            style: {
                width: `${CARD_WIDTH}px`,
                height: `${CARD_HEIGHT}px`,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                background: "#f3f4f6",
                fontFamily: "Inter, sans-serif",
                padding: "72px",
            },
        },
        h(
            "div",
            {
                style: {
                    display: "flex",
                    flexDirection: "column",
                    width: "100%",
                    height: "100%",
                    background: "#ffffff",
                    borderRadius: "52px",
                    border: "1px solid #e5e7eb",
                    overflow: "hidden",
                },
            },
            h(
                "div",
                {
                    style: {
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "48px 52px 30px 52px",
                        borderBottom: "1px solid #edf0f2",
                    },
                },
                h(
                    "div",
                    {
                        style: {
                            display: "flex",
                            alignItems: "center",
                            gap: "18px",
                        },
                    },
                    avatarDataUrl
                        ? h("img", {
                            src: avatarDataUrl,
                            width: "64",
                            height: "64",
                            style: {
                                width: "64px",
                                height: "64px",
                                borderRadius: "999px",
                                border: "1px solid #e5e7eb",
                                objectFit: "cover",
                            },
                        })
                        : h(
                            "div",
                            {
                                style: {
                                    width: "64px",
                                    height: "64px",
                                    borderRadius: "999px",
                                    background: "#111827",
                                    color: "#ffffff",
                                    fontSize: "28px",
                                    fontWeight: 700,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                },
                            },
                            avatarLetter
                        ),
                    h(
                        "div",
                        {
                            style: {
                                display: "flex",
                                flexDirection: "column",
                                gap: "3px",
                            },
                        },
                        h("span", { style: { color: "#111827", fontSize: "34px", fontWeight: 800, letterSpacing: "-0.4px" } }, "Club Threads"),
                        h("span", { style: { color: "#6b7280", fontSize: "24px" } }, `@${post.authorUsername}`)
                    )
                ),
                h(
                    "span",
                    {
                        style: {
                            color: "#111827",
                            background: "#f3f4f6",
                            fontSize: "22px",
                            borderRadius: "999px",
                            padding: "12px 18px",
                            fontWeight: 700,
                        },
                    },
                    hasMedia ? "MEDIA" : "POST"
                )
            ),
            h(
                "div",
                {
                    style: {
                        display: "flex",
                        flexDirection: "column",
                        padding: "46px 52px 0 52px",
                        flex: 1,
                    },
                },
                h(
                    "div",
                    { style: { display: "flex", alignItems: "center", gap: "16px", marginBottom: "32px" } },
                    avatarDataUrl
                        ? h("img", {
                            src: avatarDataUrl,
                            width: "88",
                            height: "88",
                            style: {
                                width: "88px",
                                height: "88px",
                                borderRadius: "999px",
                                objectFit: "cover",
                                border: "1px solid #e5e7eb",
                            },
                        })
                        : h(
                            "div",
                            {
                                style: {
                                    width: "88px",
                                    height: "88px",
                                    borderRadius: "999px",
                                    background: "#111827",
                                    color: "#ffffff",
                                    fontSize: "36px",
                                    fontWeight: 700,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                },
                            },
                            avatarLetter
                        ),
                    h(
                        "div",
                        { style: { display: "flex", flexDirection: "column", gap: "6px" } },
                        h("span", { style: { color: "#111827", fontSize: "44px", fontWeight: 800, letterSpacing: "-0.6px" } }, post.authorUsername),
                        h("span", { style: { color: "#6b7280", fontSize: "30px" } }, `@${post.authorUsername}`)
                    )
                ),
                hasText
                    ? h(
                        "p",
                        {
                            style: {
                                color: "#111827",
                                fontSize: hasMedia ? "52px" : "58px",
                                lineHeight: 1.34,
                                margin: 0,
                                marginBottom: hasMedia ? "24px" : "0",
                                display: "flex",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                overflow: "hidden",
                                maxHeight: hasMedia ? "290px" : "860px",
                            },
                        },
                        postBody
                    )
                    : null,
                hasMedia && mediaPreview
                    ? h(
                        "div",
                        {
                            style: {
                                position: "relative",
                                width: "100%",
                                height: hasText ? "540px" : "860px",
                                borderRadius: "34px",
                                overflow: "hidden",
                                border: "1px solid #e5e7eb",
                                background: "#f9fafb",
                            },
                        },
                        h("img", {
                            src: mediaPreview.dataUrl,
                            width: "976",
                            height: hasText ? "540" : "860",
                            style: {
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                            },
                        }),
                        mediaPreview.isVideo
                            ? h(
                                "div",
                                {
                                    style: {
                                        position: "absolute",
                                        right: "18px",
                                        top: "18px",
                                        background: "rgba(17,24,39,0.76)",
                                        color: "#ffffff",
                                        borderRadius: "999px",
                                        padding: "10px 16px",
                                        fontSize: "22px",
                                        fontWeight: 700,
                                    },
                                },
                                "Video preview"
                            )
                            : null
                    )
                    : !hasText
                        ? h(
                        "p",
                        {
                            style: {
                                color: "#111827",
                                fontSize: "58px",
                                lineHeight: 1.34,
                                margin: 0,
                                display: "flex",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                overflow: "hidden",
                                maxHeight: "860px",
                            },
                        },
                        " "
                    )
                        : null,
                h(
                    "div",
                    {
                        style: {
                            marginTop: "30px",
                            color: "#6b7280",
                            fontSize: "32px",
                            borderBottom: "1px solid #edf0f2",
                            paddingBottom: "30px",
                        },
                    },
                    date
                ),
                h(
                    "div",
                    {
                        style: {
                            display: "flex",
                            gap: "38px",
                            alignItems: "center",
                            color: "#4b5563",
                            fontSize: "30px",
                            paddingTop: "30px",
                        },
                    },
                    stat("❤", post.favCount, "#4b5563"),
                    stat("🗑", post.trashCount, "#4b5563"),
                    stat("🔁", post.rtCount, "#4b5563")
                )
            ),
            h(
                "div",
                {
                    style: {
                        marginTop: "auto",
                        padding: "24px 52px 34px 52px",
                        borderTop: "1px solid #edf0f2",
                        color: "#6b7280",
                        fontSize: "24px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    },
                },
                h("span", null, `Paylasim: ${SHARE_DOMAIN}`),
                h("span", { style: { fontWeight: 700, color: "#111827" } }, "club threads")
            )
        )
    );
}

function stat(icon: string, count: number, color: string): object {
    return h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "12px" } },
        h("span", { style: { fontSize: "36px" } }, icon),
        h("span", { style: { color, fontSize: "36px", fontWeight: 700 } }, compactNumber(count))
    );
}

function compactNumber(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
    return String(value);
}

function normalizeAssetUrl(url: string | null): string | null {
    if (!url) return null;
    const clean = url.trim();
    if (!clean) return null;
    if (clean.startsWith("//")) return `https:${clean}`;
    if (/^https?:\/\//i.test(clean)) return clean;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(clean)) return `https://${clean}`;

    const origin = resolveAssetOrigin();
    return `${origin}${clean.startsWith("/") ? "" : "/"}${clean}`;
}

function resolveAssetOrigin(): string {
    const configured =
        process.env.SHARE_CARD_ASSET_ORIGIN ||
        process.env.APP_ORIGIN ||
        process.env.CF_TUNNEL_HOSTNAME;

    if (!configured) return DEFAULT_ASSET_ORIGIN;
    if (/^https?:\/\//i.test(configured)) return configured.replace(/\/$/, "");
    return `https://${configured.replace(/\/$/, "")}`;
}

function resolveUploadDir(): string {
    return process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
}

function tryResolveLocalMediaPath(rawUrl: string | null): string | null {
    if (!rawUrl) return null;
    const clean = rawUrl.trim();
    if (!clean) return null;

    // Stored as plain filename (e.g. 123_uuid.webp)
    if (!clean.includes("/") && !clean.includes(":")) {
        const candidate = path.join(resolveUploadDir(), clean);
        return fs.existsSync(candidate) ? candidate : null;
    }

    let pathname: string | null = null;
    if (clean.startsWith("/")) {
        pathname = clean;
    } else if (/^https?:\/\//i.test(clean)) {
        try {
            pathname = new URL(clean).pathname;
        } catch {
            pathname = null;
        }
    }

    if (!pathname?.startsWith("/media/")) return null;

    const filename = path.basename(pathname);
    const candidate = path.join(resolveUploadDir(), filename);
    return fs.existsSync(candidate) ? candidate : null;
}

function httpGetBuffer(url: string, redirects = 3): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === "https:" ? https : http;

        const req = client.get(parsed, (res) => {
            const statusCode = res.statusCode ?? 0;

            if (statusCode >= 300 && statusCode < 400 && res.headers.location && redirects > 0) {
                const nextUrl = new URL(res.headers.location, url).toString();
                res.resume();
                void httpGetBuffer(nextUrl, redirects - 1).then(resolve).catch(reject);
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                res.resume();
                reject(new Error(`HTTP ${statusCode} for ${url}`));
                return;
            }

            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on("end", () => resolve(Buffer.concat(chunks)));
        });

        req.on("error", reject);
    });
}

async function readMediaBuffer(rawUrl: string | null): Promise<Buffer> {
    const localPath = tryResolveLocalMediaPath(rawUrl);
    if (localPath) {
        return fsp.readFile(localPath);
    }

    const absoluteUrl = normalizeAssetUrl(rawUrl);
    if (!absoluteUrl || !/^https?:\/\//i.test(absoluteUrl)) {
        throw new Error("Media URL is not resolvable for share card");
    }

    return httpGetBuffer(absoluteUrl);
}

async function createVideoPreviewBuffer(rawUrl: string | null): Promise<Buffer> {
    const localPath = tryResolveLocalMediaPath(rawUrl);
    const sourcePath = localPath ?? path.join(os.tmpdir(), `share_video_${randomUUID()}.mp4`);
    const framePath = path.join(os.tmpdir(), `share_frame_${randomUUID()}.jpg`);

    try {
        if (!localPath) {
            const downloaded = await readMediaBuffer(rawUrl);
            await fsp.writeFile(sourcePath, downloaded);
        }

        await new Promise<void>((resolve, reject) => {
            ffmpeg(sourcePath)
                .outputOptions(["-ss 00:00:00.2", "-frames:v 1"])
                .on("end", () => resolve())
                .on("error", (err) => reject(new Error(`FFmpeg preview error: ${err.message}`)))
                .save(framePath);
        });

        return await sharp(framePath)
            .resize(976, 860, { fit: "cover", position: "center" })
            .jpeg({ quality: 86, mozjpeg: true })
            .toBuffer();
    } finally {
        await Promise.allSettled([
            fsp.unlink(framePath).catch(() => { }),
            localPath ? Promise.resolve() : fsp.unlink(sourcePath).catch(() => { }),
        ]);
    }
}

async function createMediaPreview(post: CardPost): Promise<CardMediaPreview | null> {
    if (!post.mediaUrl || !post.mediaMimeType) {
        return null;
    }

    try {
        if (post.mediaMimeType.startsWith("image/")) {
            const imageBuffer = await readMediaBuffer(post.mediaUrl);
            const cardImage = await sharp(imageBuffer)
                .rotate()
                .resize(976, 860, { fit: "cover", position: "center" })
                .jpeg({ quality: 86, mozjpeg: true })
                .toBuffer();
            return {
                dataUrl: `data:image/jpeg;base64,${cardImage.toString("base64")}`,
                isVideo: false,
            };
        }

        if (post.mediaMimeType.startsWith("video/")) {
            const previewBuffer = await createVideoPreviewBuffer(post.mediaUrl);
            return {
                dataUrl: `data:image/jpeg;base64,${previewBuffer.toString("base64")}`,
                isVideo: true,
            };
        }
    } catch (error) {
        console.warn(`[cardGen] Media preview skipped: ${(error as Error).message}`);
    }

    return null;
}

async function createAvatarDataUrl(rawUrl: string | null): Promise<string | null> {
    if (!rawUrl) return null;
    try {
        const avatarBuffer = await readMediaBuffer(rawUrl);
        const normalized = await sharp(avatarBuffer)
            .rotate()
            .resize(88, 88, { fit: "cover", position: "center" })
            .png({ compressionLevel: 7 })
            .toBuffer();
        return `data:image/png;base64,${normalized.toString("base64")}`;
    } catch (error) {
        console.warn(`[cardGen] Avatar preview skipped: ${(error as Error).message}`);
        return null;
    }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * generateShareCard
 * Fetches post + author data, renders a 1080×1920 card via Satori,
 * then compresses it to PNG with Sharp.
 *
 * @returns PNG Buffer ready to stream as `Content-Type: image/png`
 */
export async function generateShareCard(postId: string): Promise<Buffer> {
    // 1. Fetch post + author in a single join query
    const result = await db
        .select({
            content: posts.content,
            createdAt: posts.createdAt,
            favCount: posts.favCount,
            trashCount: posts.trashCount,
            rtCount: posts.rtCount,
            authorUsername: users.username,
            authorProfilePic: users.profilePic,
            mediaUrl: posts.mediaUrl,
            mediaMimeType: posts.mediaMimeType,
        })
        .from(posts)
        .innerJoin(users, eq(posts.userId, users.id))
        .where(eq(posts.id, postId))
        .limit(1);

    if (result.length === 0) {
        throw new Error(`Post not found: ${postId}`);
    }

    const post = result[0] as CardPost;
    const mediaPreview = await createMediaPreview(post);
    const avatarDataUrl = await createAvatarDataUrl(post.authorProfilePic);

    // 2. Render with Satori → SVG string
    // Satori accepts plain objects (no JSX / React.ReactNode required)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svg = await satori(buildCardElement(post, mediaPreview, avatarDataUrl) as any, {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        fonts: SATORI_FONTS,
    });

    // 3. Convert SVG → PNG via Sharp
    const pngBuffer = await sharp(Buffer.from(svg))
        .png({
            compressionLevel: 7,
            adaptiveFiltering: true,
        })
        .toBuffer();

    return pngBuffer;
}
