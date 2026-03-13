import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db";
import { communities, postCommunities, posts, users } from "../db/schema";
import { desc, eq, sql, ilike, isNull, and } from "drizzle-orm";
import { getHotKeywords, getKeywordFeed, getNextCursor, getTopPostsWithAnalytics } from "../services/decay";
import type { AuthRequest } from "../plugins/auth";
import { withLinkPreview } from "../services/linkPreview";
import { buildViewerBlockFilter } from "../services/blocking";
import { attachPostViewCounts } from "../services/postViews";

const TrendingPostsQuerySchema = z.object({
    window: z.enum(["24h", "7d"]).optional(),
    limit: z.string().optional(),
});

const TrendingKeywordsQuerySchema = z.object({
    window: z.enum(["1h", "6h", "24h"]).optional(),
    limit: z.string().optional(),
});

const TrendingKeywordFeedQuerySchema = z.object({
    cursor: z.string().optional(),
    limit: z.string().optional(),
});

const TRENDING_POSTS_CACHE_TTL_SECONDS = 120;
const TRENDING_KEYWORDS_CACHE_TTL_SECONDS = 60;

export async function trendingRoutes(app: FastifyInstance) {
    app.get<{ Querystring: { window?: "24h" | "7d"; limit?: string } }>(
        "/trending/posts",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const parsed = TrendingPostsQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid trending query", details: parsed.error.flatten() });
            }

            const viewerId = (request as AuthRequest).userId;
            const window = parsed.data.window ?? "24h";
            const requestedLimit = parsed.data.limit ? parseInt(parsed.data.limit, 10) : 10;
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(Math.max(requestedLimit, 1), 50)
                : 10;
            const cacheKey = viewerId ? null : `trending:posts:${window}:${limit}`;

            if (cacheKey) {
                try {
                    const cached = await app.redis.get(cacheKey);
                    if (cached) {
                        return reply.send(JSON.parse(cached));
                    }
                } catch (error) {
                    app.log.warn({ err: error }, "Failed to read trending posts cache");
                }
            }

            const posts = await getTopPostsWithAnalytics(app.redis, window, limit, viewerId);
            const payload = {
                mode: "top",
                window,
                posts,
                count: posts.length,
            };

            if (cacheKey) {
                try {
                    await app.redis.set(cacheKey, JSON.stringify(payload), "EX", TRENDING_POSTS_CACHE_TTL_SECONDS);
                } catch (error) {
                    app.log.warn({ err: error }, "Failed to write trending posts cache");
                }
            }

            return reply.send(payload);
        }
    );

    app.get<{ Querystring: { window?: "1h" | "6h" | "24h"; limit?: string } }>(
        "/trending/keywords",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const parsed = TrendingKeywordsQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid keyword query", details: parsed.error.flatten() });
            }

            const viewerId = (request as AuthRequest).userId;
            const window = parsed.data.window ?? "6h";
            const requestedLimit = parsed.data.limit ? parseInt(parsed.data.limit, 10) : 10;
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(Math.max(requestedLimit, 1), 20)
                : 10;
            const cacheKey = viewerId ? null : `trending:keywords:${window}:${limit}`;

            if (cacheKey) {
                try {
                    const cached = await app.redis.get(cacheKey);
                    if (cached) {
                        return reply.send(JSON.parse(cached));
                    }
                } catch (error) {
                    app.log.warn({ err: error }, "Failed to read keyword cache");
                }
            }

            const keywords = await getHotKeywords(window, limit, viewerId);
            const payload = {
                window,
                keywords,
                count: keywords.length,
            };

            if (cacheKey) {
                try {
                    await app.redis.set(cacheKey, JSON.stringify(payload), "EX", TRENDING_KEYWORDS_CACHE_TTL_SECONDS);
                } catch (error) {
                    app.log.warn({ err: error }, "Failed to write keyword cache");
                }
            }

            return reply.send(payload);
        }
    );

    app.get<{ Params: { keyword: string }; Querystring: { cursor?: string; limit?: string } }>(
        "/trending/keywords/:keyword/posts",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const parsed = TrendingKeywordFeedQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid keyword feed query", details: parsed.error.flatten() });
            }

            let keyword = (request.params.keyword ?? "").trim();
            try {
                keyword = decodeURIComponent(keyword);
            } catch {
                // Keep raw keyword if decoding fails.
            }
            if (keyword.length < 2) {
                return reply.status(400).send({ error: "Keyword must be at least 2 characters" });
            }

            const parsedLimit = parsed.data.limit ? parseInt(parsed.data.limit, 10) : 30;
            const limit = Math.min(Math.max(parsedLimit, 1), 100);
            const viewerId = (request as AuthRequest).userId;

            const feed = await getKeywordFeed({
                keyword,
                cursor: parsed.data.cursor,
                limit,
                viewerId,
            });

            return reply.send({
                keyword,
                data: feed,
                nextCursor: getNextCursor(feed, limit),
                count: feed.length,
                mode: "keyword",
            });
        }
    );

    app.get<{ Querystring: { q?: string; page?: string } }>(
        "/search/posts",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const q = (request.query.q ?? "").trim();
            const viewerId = (request as AuthRequest).userId;
            const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
            const limit = 20;
            const offset = (page - 1) * limit;

            if (q.length < 2) return reply.send({ posts: [] });

            const result = await db
                .select({
                    id: posts.id,
                    content: posts.content,
                    mediaUrl: posts.mediaUrl,
                    mediaMimeType: posts.mediaMimeType,
                    linkPreviewUrl: posts.linkPreviewUrl,
                    linkPreviewTitle: posts.linkPreviewTitle,
                    linkPreviewDescription: posts.linkPreviewDescription,
                    linkPreviewImageUrl: posts.linkPreviewImageUrl,
                    linkPreviewSiteName: posts.linkPreviewSiteName,
                    favCount: posts.favCount,
                    trashCount: posts.trashCount,
                    rtCount: posts.rtCount,
                    replyCount: posts.replyCount,
                    createdAt: posts.createdAt,
                    authorUsername: users.username,
                    authorProfilePic: users.profilePic,
                    authorRole: users.role,
                    communityId: communities.id,
                    communitySlug: communities.slug,
                    communityName: communities.name,
                })
                .from(posts)
                .innerJoin(users, eq(posts.userId, users.id))
                .leftJoin(postCommunities, eq(postCommunities.postId, posts.id))
                .leftJoin(communities, eq(postCommunities.communityId, communities.id))
                .where(and(
                    ilike(posts.content, "%" + q + "%"),
                    isNull(posts.parentId),
                    sql`(${postCommunities.communityId} IS NULL OR ${communities.isPrivate} = false)`,
                    buildViewerBlockFilter(viewerId, posts.userId)
                ))
                .orderBy(desc(posts.createdAt))
                .limit(limit)
                .offset(offset);

            const postsWithViews = await attachPostViewCounts(result.map((row) => withLinkPreview(row)));
            return reply.send({ posts: postsWithViews, q, page });
        }
    );
}
