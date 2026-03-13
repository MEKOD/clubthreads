import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { db } from "../db";
import { posts } from "../db/schema";
import { eq } from "drizzle-orm";

const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<]+/i;
const TRAILING_URL_PUNCTUATION_REGEX = /[),.!?;:'"`]+$/;
const MAX_REDIRECTS = 2;
const MAX_HTML_BYTES = 192 * 1024;
const REQUEST_TIMEOUT_MS = 3500;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PREVIEW_USER_AGENT = "ClubThreadsLinkPreviewBot/1.0";
const DEFAULT_DOMAIN_BLACKLIST = [
    "localhost",
    "local",
    "internal",
    "home.arpa",
    "metadata.google.internal",
    "169.254.169.254",
    "100.100.100.200",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
];

export interface LinkPreview {
    url: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    siteName: string | null;
}

type CachedPreviewEntry = {
    expiresAt: number;
    value: LinkPreview | null;
};

type SafeHostResolution = {
    address: string;
    family: 4 | 6;
};

export type PendingPreviewFields = {
    linkPreviewUrl: string | null;
    linkPreviewTitle: string | null;
    linkPreviewDescription: string | null;
    linkPreviewImageUrl: string | null;
    linkPreviewSiteName: string | null;
};

const previewCache = new Map<string, CachedPreviewEntry>();
const pendingFetches = new Map<string, Promise<LinkPreview | null>>();

function normalizeCandidateUrl(rawUrl: string) {
    const trimmed = rawUrl.trim().replace(TRAILING_URL_PUNCTUATION_REGEX, "");
    return trimmed.startsWith("www.") ? `https://${trimmed}` : trimmed;
}

function collapseWhitespace(value: string | null | undefined) {
    if (!value) return null;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 0 ? normalized : null;
}

function decodeBasicHtmlEntities(value: string | null) {
    if (!value) return null;
    return value
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">");
}

function truncate(value: string | null, maxLength: number) {
    if (!value) return null;
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function getDomainBlacklist() {
    const extra = (process.env.LINK_PREVIEW_DOMAIN_BLACKLIST ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    return new Set([...DEFAULT_DOMAIN_BLACKLIST, ...extra]);
}

function isBlacklistedHostname(hostname: string) {
    const normalized = hostname.toLowerCase();
    const blacklist = getDomainBlacklist();
    for (const blocked of blacklist) {
        if (normalized === blocked || normalized.endsWith(`.${blocked}`)) {
            return true;
        }
    }
    return false;
}

function isPrivateIpv4(address: string) {
    const octets = address.split(".").map((part) => Number(part));
    if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
        return true;
    }
    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
}

function isPrivateIpv6(address: string) {
    const normalized = address.toLowerCase();
    return (
        normalized === "::1" ||
        normalized === "::" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb") ||
        normalized.startsWith("2001:db8")
    );
}

async function resolveSafeHostname(hostname: string): Promise<SafeHostResolution> {
    if (isBlacklistedHostname(hostname)) {
        throw new Error(`Hostname blocked: ${hostname}`);
    }

    const ipFamily = net.isIP(hostname);
    if (ipFamily) {
        const blocked = ipFamily === 4 ? isPrivateIpv4(hostname) : isPrivateIpv6(hostname);
        if (blocked) {
            throw new Error(`Private IP blocked: ${hostname}`);
        }
        return { address: hostname, family: ipFamily as 4 | 6 };
    }

    const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
    if (resolved.length === 0) {
        throw new Error(`Hostname did not resolve: ${hostname}`);
    }

    for (const entry of resolved) {
        const blocked = entry.family === 4 ? isPrivateIpv4(entry.address) : isPrivateIpv6(entry.address);
        if (blocked) {
            throw new Error(`Resolved private IP blocked: ${hostname}`);
        }
    }

    const preferred = resolved.find((entry) => entry.family === 4) ?? resolved[0];
    return {
        address: preferred.address,
        family: preferred.family as 4 | 6,
    };
}

async function fetchHtml(url: URL, redirects = 0): Promise<{ finalUrl: URL; html: string }> {
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error(`Unsupported protocol: ${url.protocol}`);
    }

    const resolution = await resolveSafeHostname(url.hostname);

    const client = url.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
        const req = client.get(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || undefined,
                path: `${url.pathname}${url.search}`,
                headers: {
                    "user-agent": PREVIEW_USER_AGENT,
                    accept: "text/html,application/xhtml+xml",
                },
                lookup: (_hostname, _options, callback) => {
                    callback(null, resolution.address, resolution.family);
                },
            },
            (res) => {
                const statusCode = res.statusCode ?? 0;
                const location = res.headers.location;

                if (statusCode >= 300 && statusCode < 400 && location && redirects < MAX_REDIRECTS) {
                    const nextUrl = new URL(location, url);
                    res.resume();
                    void fetchHtml(nextUrl, redirects + 1).then(resolve).catch(reject);
                    return;
                }

                if (statusCode < 200 || statusCode >= 300) {
                    res.resume();
                    reject(new Error(`Preview HTTP ${statusCode}`));
                    return;
                }

                const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
                if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
                    res.resume();
                    reject(new Error(`Preview content-type blocked: ${contentType || "unknown"}`));
                    return;
                }

                const contentLength = Number(res.headers["content-length"] ?? 0);
                if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
                    res.resume();
                    reject(new Error(`Preview payload too large: ${contentLength}`));
                    return;
                }

                const chunks: Buffer[] = [];
                let receivedBytes = 0;

                res.on("data", (chunk) => {
                    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    receivedBytes += bufferChunk.length;
                    if (receivedBytes > MAX_HTML_BYTES) {
                        req.destroy(new Error("Preview payload exceeded limit"));
                        return;
                    }
                    chunks.push(bufferChunk);
                });

                res.on("end", () => {
                    resolve({
                        finalUrl: url,
                        html: Buffer.concat(chunks).toString("utf8"),
                    });
                });
            }
        );

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error("Preview request timed out"));
        });

        req.on("error", reject);
    });
}

function extractMetaContent(html: string, key: string) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`, "i"),
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
            return truncate(collapseWhitespace(decodeBasicHtmlEntities(match[1])), 280);
        }
    }
    return null;
}

function extractTitle(html: string) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return truncate(collapseWhitespace(decodeBasicHtmlEntities(titleMatch?.[1] ?? null)), 140);
}

async function resolveOptionalUrl(baseUrl: URL, rawUrl: string | null) {
    if (!rawUrl) return null;
    try {
        const resolved = new URL(rawUrl, baseUrl);
        if (!["http:", "https:"].includes(resolved.protocol)) {
            return null;
        }
        await resolveSafeHostname(resolved.hostname);
        return resolved.toString();
    } catch {
        return null;
    }
}

async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
    const cached = previewCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }

    const pending = pendingFetches.get(url);
    if (pending) {
        return pending;
    }

    const task = (async () => {
        try {
            const initialUrl = new URL(url);
            const { finalUrl, html } = await fetchHtml(initialUrl);
            const title = extractMetaContent(html, "og:title")
                ?? extractMetaContent(html, "twitter:title")
                ?? extractTitle(html);

            if (!title) {
                previewCache.set(url, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
                return null;
            }

            const description = extractMetaContent(html, "og:description")
                ?? extractMetaContent(html, "twitter:description")
                ?? extractMetaContent(html, "description");
            const imageUrl = await resolveOptionalUrl(
                finalUrl,
                extractMetaContent(html, "og:image") ?? extractMetaContent(html, "twitter:image")
            );
            const siteName = truncate(
                extractMetaContent(html, "og:site_name") ?? finalUrl.hostname.replace(/^www\./i, ""),
                120
            );

            const value: LinkPreview = {
                url: finalUrl.toString(),
                title,
                description: truncate(description, 220),
                imageUrl,
                siteName,
            };

            previewCache.set(url, { value, expiresAt: Date.now() + CACHE_TTL_MS });
            return value;
        } catch (error) {
            console.warn(`[linkPreview] skipped ${url}: ${(error as Error).message}`);
            previewCache.set(url, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
            return null;
        } finally {
            pendingFetches.delete(url);
        }
    })();

    pendingFetches.set(url, task);
    return task;
}

export function extractFirstUrl(content: string | null | undefined) {
    if (!content) return null;
    const match = content.match(URL_REGEX);
    return match?.[0] ? normalizeCandidateUrl(match[0]) : null;
}

export function buildLinkPreview(fields: PendingPreviewFields): LinkPreview | null {
    if (!fields.linkPreviewUrl || !fields.linkPreviewTitle) {
        return null;
    }

    return {
        url: fields.linkPreviewUrl,
        title: fields.linkPreviewTitle,
        description: fields.linkPreviewDescription,
        imageUrl: fields.linkPreviewImageUrl,
        siteName: fields.linkPreviewSiteName,
    };
}

export function withLinkPreview<T extends Record<string, unknown> & PendingPreviewFields>(row: T): Omit<T, keyof PendingPreviewFields> & { linkPreview: LinkPreview | null } {
    const { linkPreviewUrl, linkPreviewTitle, linkPreviewDescription, linkPreviewImageUrl, linkPreviewSiteName, ...rest } = row;
    return {
        ...rest,
        linkPreview: buildLinkPreview({
            linkPreviewUrl,
            linkPreviewTitle,
            linkPreviewDescription,
            linkPreviewImageUrl,
            linkPreviewSiteName,
        }),
    };
}

export async function hydratePostLinkPreview(postId: string, content: string | null | undefined) {
    const firstUrl = extractFirstUrl(content);
    if (!firstUrl) {
        return;
    }

    const preview = await fetchLinkPreview(firstUrl);
    if (!preview) {
        return;
    }

    await db
        .update(posts)
        .set({
            linkPreviewUrl: preview.url,
            linkPreviewTitle: preview.title,
            linkPreviewDescription: preview.description,
            linkPreviewImageUrl: preview.imageUrl,
            linkPreviewSiteName: preview.siteName,
            updatedAt: new Date(),
        })
        .where(eq(posts.id, postId));
}
