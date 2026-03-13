import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db";
import { communities, communityInvites, communityJoinRequests, communityMembers, communityRules, notifications, postCommunities, posts, users } from "../db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { AuthRequest } from "../plugins/auth";
import { getCommunityAccessBySlug, hasCommunityRole } from "../services/communityAccess";
import { createPostForUser, CreatePostSchema } from "../services/postCreation";
import { getCommunityHotKeywords, getCommunityTopPostsWithAnalytics } from "../services/decay";
import { publishNotificationEvent } from "../services/notificationHub";
import { incrementCounter } from "../services/analytics";
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MediaReferenceSchema = z
    .string()
    .trim()
    .refine((value) => /^https?:\/\//i.test(value) || value.startsWith("/"), {
        message: "Media reference must be an absolute URL or uploaded media path",
    });

const CreateCommunitySchema = z.object({
    name: z.string().min(2).max(64),
    slug: z
        .string()
        .min(2)
        .max(64)
        .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens"),
    description: z.string().max(1000).optional(),
    isPrivate: z.boolean().optional(),
    avatarUrl: MediaReferenceSchema.optional(),
    bannerUrl: MediaReferenceSchema.optional(),
});

const UpdateCommunitySchema = z.object({
    name: z.string().min(2).max(64).optional(),
    description: z.string().max(1000).nullable().optional(),
    isPrivate: z.boolean().optional(),
    avatarUrl: MediaReferenceSchema.nullable().optional(),
    bannerUrl: MediaReferenceSchema.nullable().optional(),
});

const UpsertRuleSchema = z.object({
    title: z.string().min(2).max(120),
    description: z.string().min(2).max(2000),
    sortOrder: z.number().int().min(0).max(999).optional(),
});

const UpdateMemberRoleSchema = z.object({
    role: z.enum(["moderator", "member"]),
});

const CreateInviteSchema = z.object({
    username: z.string().min(3).max(32),
});

const CommunityDiscoverQuerySchema = z.object({
    window: z.enum(["24h", "7d"]).optional(),
    keywordWindow: z.enum(["1h", "6h", "24h"]).optional(),
    limit: z.string().optional(),
});

const COMMUNITY_DISCOVER_CACHE_TTL_SECONDS = 90;

function normalizeSlug(value: string) {
    return value.trim().toLowerCase();
}

const COMMUNITY_MEMBER_MILESTONES = [10, 100, 1000] as const;

function buildCommunityCreatedPost(username: string, slug: string) {
    return `Yeni ideoloji kuruldu: @${username} /${slug} toplulugunu acti. Kimler katiliyor?`;
}

function buildCommunityMilestonePost(slug: string, memberCount: number) {
    if (memberCount === 10) {
        return `/${slug} ilk 10 uyeye ulasti. Erken gelen ekip masayi kurdu, simdi ivme yeni basliyor.`;
    }

    if (memberCount === 100) {
        return `/${slug} 100 uye barajini gecti. Bu artik sessiz bir topluluk degil, kendi akisini kuran bir alan oldu.`;
    }

    return `/${slug} tam ${memberCount} uyeye ulasti. Bu seviye hype degil, kalici etki.`;
}

async function maybeInsertCommunityMilestonePost(tx: DbTransaction, communityId: string, userId: string, slug: string, memberCount: number) {
    if (!COMMUNITY_MEMBER_MILESTONES.includes(memberCount as (typeof COMMUNITY_MEMBER_MILESTONES)[number])) {
        return;
    }

    const content = buildCommunityMilestonePost(slug, memberCount);
    const [existingMilestonePost] = await tx
        .select({ id: posts.id })
        .from(posts)
        .innerJoin(postCommunities, eq(postCommunities.postId, posts.id))
        .where(and(eq(postCommunities.communityId, communityId), eq(posts.content, content)))
        .limit(1);

    if (existingMilestonePost) {
        return;
    }

    const [createdPost] = await tx
        .insert(posts)
        .values({
            userId,
            content,
            type: "post",
        })
        .returning({ id: posts.id });

    await tx.insert(postCommunities).values({
        communityId,
        postId: createdPost.id,
    });
}

export async function communityRoutes(app: FastifyInstance) {
    app.get(
        "/communities/me/invites",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;

            const invites = await db
                .select({
                    communityId: communities.id,
                    slug: communities.slug,
                    name: communities.name,
                    description: communities.description,
                    isPrivate: communities.isPrivate,
                    memberCount: communities.memberCount,
                    avatarUrl: communities.avatarUrl,
                    bannerUrl: communities.bannerUrl,
                    creatorId: communities.creatorId,
                    createdAt: communities.createdAt,
                    invitedAt: communityInvites.createdAt,
                    inviterUsername: users.username,
                })
                .from(communityInvites)
                .innerJoin(communities, eq(communityInvites.communityId, communities.id))
                .innerJoin(users, eq(communityInvites.inviterUserId, users.id))
                .where(eq(communityInvites.invitedUserId, userId))
                .orderBy(desc(communityInvites.createdAt));

            return reply.send({ invites });
        }
    );

    app.get<{ Querystring: { q?: string; limit?: string; scope?: string } }>(
        "/communities",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const q = (request.query.q ?? "").trim().toLowerCase();
            const limit = Math.min(30, Math.max(1, parseInt(request.query.limit ?? "12", 10)));
            const scope = request.query.scope === "discover" || request.query.scope === "joined" ? request.query.scope : undefined;
            const userId = (request as AuthRequest).userId;

            const membershipFilter = userId
                ? sql`EXISTS(
                    SELECT 1
                    FROM ${communityMembers}
                    WHERE ${communityMembers.communityId} = ${communities.id}
                      AND ${communityMembers.userId} = ${userId}
                )`
                : sql`false`;

            const searchFilter = q
                ? sql`(
                    ${communities.name} ILIKE ${"%" + q + "%"}
                    OR ${communities.slug} ILIKE ${"%" + q + "%"}
                    OR ${communities.description} ILIKE ${"%" + q + "%"}
                )`
                : sql`true`;

            const baseFilter = q
                ? sql`true`
                : scope === "discover"
                    ? sql`${communities.isPrivate} = false`
                    : scope === "joined"
                        ? membershipFilter
                        : membershipFilter;

            const communityList = await db
                .select({
                    id: communities.id,
                    name: communities.name,
                    slug: communities.slug,
                    description: communities.description,
                    isPrivate: communities.isPrivate,
                    memberCount: communities.memberCount,
                    avatarUrl: communities.avatarUrl,
                    bannerUrl: communities.bannerUrl,
                    creatorId: communities.creatorId,
                    createdAt: communities.createdAt,
                })
                .from(communities)
                .where(sql`${baseFilter} AND ${searchFilter}`)
                .orderBy(desc(communities.memberCount), desc(communities.createdAt))
                .limit(limit);

            let membershipMap = new Map<string, "owner" | "moderator" | "member">();
            let inviteSet = new Set<string>();
            let requestSet = new Set<string>();
            if (userId && communityList.length > 0) {
                const communityIds = communityList.map((community) => sql`${community.id}`);
                const [memberships, invites, requests] = await Promise.all([
                    db
                        .select({
                            communityId: communityMembers.communityId,
                            role: communityMembers.role,
                        })
                        .from(communityMembers)
                        .where(
                            sql`${communityMembers.userId} = ${userId} AND ${communityMembers.communityId} IN (${sql.join(
                                communityIds,
                                sql`, `
                            )})`
                        ),
                    db
                        .select({ communityId: communityInvites.communityId })
                        .from(communityInvites)
                        .where(
                            sql`${communityInvites.invitedUserId} = ${userId} AND ${communityInvites.communityId} IN (${sql.join(
                                communityIds,
                                sql`, `
                            )})`
                        ),
                    db
                        .select({ communityId: communityJoinRequests.communityId })
                        .from(communityJoinRequests)
                        .where(
                            sql`${communityJoinRequests.userId} = ${userId} AND ${communityJoinRequests.communityId} IN (${sql.join(
                                communityIds,
                                sql`, `
                            )})`
                        ),
                ]);

                membershipMap = new Map(memberships.map((membership) => [membership.communityId, membership.role]));
                inviteSet = new Set(invites.map((invite) => invite.communityId));
                requestSet = new Set(requests.map((request) => request.communityId));
            }

            return reply.send({
                communities: communityList.map((community) => {
                    const viewerRole = membershipMap.get(community.id) ?? null;
                    return {
                        ...community,
                        isMember: Boolean(viewerRole),
                        viewerRole,
                        hasInvite: inviteSet.has(community.id),
                        hasRequestedJoin: requestSet.has(community.id),
                    };
                }),
            });
        }
    );

    app.post(
        "/communities",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;

            const body = CreateCommunitySchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });
            }

            const { name, description, avatarUrl, bannerUrl } = body.data;
            const slug = normalizeSlug(body.data.slug);
            const isPrivate = body.data.isPrivate ?? false;

            const existing = await db
                .select({ id: communities.id })
                .from(communities)
                .where(eq(communities.slug, slug))
                .limit(1);

            if (existing.length > 0) {
                return reply.status(409).send({ error: "Slug already in use" });
            }

            const community = await db.transaction(async (tx) => {
                const [createdCommunity] = await tx
                    .insert(communities)
                    .values({
                        name,
                        slug,
                        description: description ?? null,
                        creatorId: userId,
                        isPrivate,
                        avatarUrl: avatarUrl ?? null,
                        bannerUrl: bannerUrl ?? null,
                        memberCount: 1,
                    })
                    .returning();

                await tx.insert(communityMembers).values({
                    communityId: createdCommunity.id,
                    userId,
                    role: "owner",
                });

                const [createdPost] = await tx
                    .insert(posts)
                    .values({
                        userId,
                        content: buildCommunityCreatedPost((request as AuthRequest).username, slug),
                        type: "post",
                    })
                    .returning({ id: posts.id });

                await tx.insert(postCommunities).values({
                    communityId: createdCommunity.id,
                    postId: createdPost.id,
                });

                return createdCommunity;
            });

            return reply.status(201).send({
                community: {
                    ...community,
                    isMember: true,
                    viewerRole: "owner",
                },
            });
        }
    );

    app.get<{ Params: { slug: string } }>(
        "/communities/:slug",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const { slug } = request.params;
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!access.canView) return reply.status(403).send({ error: "Community is private" });

            const [community, rules] = await Promise.all([
                db
                    .select({
                        id: communities.id,
                        name: communities.name,
                        slug: communities.slug,
                        description: communities.description,
                        isPrivate: communities.isPrivate,
                        memberCount: communities.memberCount,
                        avatarUrl: communities.avatarUrl,
                        bannerUrl: communities.bannerUrl,
                        creatorId: communities.creatorId,
                        createdAt: communities.createdAt,
                    })
                    .from(communities)
                    .where(eq(communities.id, access.community.id))
                    .limit(1)
                    .then((rows) => rows[0] ?? null),
                db
                    .select({
                        id: communityRules.id,
                        title: communityRules.title,
                        description: communityRules.description,
                        sortOrder: communityRules.sortOrder,
                        createdAt: communityRules.createdAt,
                        createdBy: communityRules.createdBy,
                    })
                    .from(communityRules)
                    .where(eq(communityRules.communityId, access.community.id))
                    .orderBy(asc(communityRules.sortOrder), asc(communityRules.createdAt)),
            ]);

            if (!community) return reply.status(404).send({ error: "Community not found" });

            const [hasInvite, hasRequestedJoin] = userId
                ? await Promise.all([
                    db
                        .select({ communityId: communityInvites.communityId })
                        .from(communityInvites)
                        .where(and(eq(communityInvites.communityId, access.community.id), eq(communityInvites.invitedUserId, userId)))
                        .limit(1)
                        .then((rows) => rows.length > 0),
                    db
                        .select({ communityId: communityJoinRequests.communityId })
                        .from(communityJoinRequests)
                        .where(and(eq(communityJoinRequests.communityId, access.community.id), eq(communityJoinRequests.userId, userId)))
                        .limit(1)
                        .then((rows) => rows.length > 0),
                ])
                : [false, false];

            return reply.send({
                community: {
                    ...community,
                    isMember: access.isMember,
                    viewerRole: access.membership?.role ?? null,
                    permissions: {
                        canView: access.canView,
                        canPost: access.canPost,
                        canModerate: access.canModerate,
                        canManage: access.canManage,
                        canDelete: access.canDelete,
                    },
                    hasInvite,
                    hasRequestedJoin,
                },
                rules,
            });
        }
    );

    app.get<{ Params: { slug: string }; Querystring: { window?: "24h" | "7d"; keywordWindow?: "1h" | "6h" | "24h"; limit?: string } }>(
        "/communities/:slug/discover",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);
            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!access.canView) return reply.status(403).send({ error: "Community is private" });

            const parsed = CommunityDiscoverQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid discover query", details: parsed.error.flatten() });
            }

            const limit = parsed.data.limit ? Math.min(Math.max(parseInt(parsed.data.limit, 10), 1), 20) : 10;
            const window = parsed.data.window ?? "24h";
            const keywordWindow = parsed.data.keywordWindow ?? "6h";
            const canUseSharedCache = !userId && !access.community.isPrivate;
            const topPostsCacheKey = canUseSharedCache
                ? `community:discover:top:${access.community.id}:${window}:${limit}`
                : null;

            const [topPosts, keywords, members] = await Promise.all([
                (async () => {
                    if (topPostsCacheKey) {
                        try {
                            const cached = await app.redis.get(topPostsCacheKey);
                            if (cached) {
                                return JSON.parse(cached);
                            }
                        } catch (error) {
                            app.log.warn({ err: error }, "Failed to read community discover top-post cache");
                        }
                    }

                    const posts = await getCommunityTopPostsWithAnalytics(app.redis, access.community.id, window, limit, userId);

                    if (topPostsCacheKey) {
                        try {
                            await app.redis.set(topPostsCacheKey, JSON.stringify(posts), "EX", COMMUNITY_DISCOVER_CACHE_TTL_SECONDS);
                        } catch (error) {
                            app.log.warn({ err: error }, "Failed to write community discover top-post cache");
                        }
                    }

                    return posts;
                })(),
                getCommunityHotKeywords(access.community.id, keywordWindow, limit),
                db
                    .select({
                        userId: users.id,
                        username: users.username,
                        profilePic: users.profilePic,
                        role: communityMembers.role,
                    })
                    .from(communityMembers)
                    .innerJoin(users, eq(communityMembers.userId, users.id))
                    .where(eq(communityMembers.communityId, access.community.id))
                    .orderBy(
                        sql`CASE
                            WHEN ${communityMembers.role} = 'owner' THEN 0
                            WHEN ${communityMembers.role} = 'moderator' THEN 1
                            ELSE 2
                        END`,
                        asc(communityMembers.joinedAt)
                    )
                    .limit(12),
            ]);

            return reply.send({
                community: {
                    id: access.community.id,
                    slug: access.community.slug,
                    isPrivate: access.community.isPrivate,
                },
                topPosts,
                keywords,
                members,
            });
        }
    );

    app.patch<{ Params: { slug: string } }>(
        "/communities/:slug",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!access.canManage) return reply.status(403).send({ error: "Only the owner can update community settings" });

            const body = UpdateCommunitySchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });
            }

            const updates: Record<string, unknown> = {};
            if (body.data.name !== undefined) updates.name = body.data.name;
            if (body.data.description !== undefined) updates.description = body.data.description;
            if (body.data.isPrivate !== undefined) updates.isPrivate = body.data.isPrivate;
            if (body.data.avatarUrl !== undefined) updates.avatarUrl = body.data.avatarUrl;
            if (body.data.bannerUrl !== undefined) updates.bannerUrl = body.data.bannerUrl;

            if (Object.keys(updates).length === 0) {
                return reply.status(400).send({ error: "No valid updates were provided" });
            }

            const [community] = await db
                .update(communities)
                .set(updates)
                .where(eq(communities.id, access.community.id))
                .returning({
                    id: communities.id,
                    name: communities.name,
                    slug: communities.slug,
                    description: communities.description,
                    isPrivate: communities.isPrivate,
                    memberCount: communities.memberCount,
                    avatarUrl: communities.avatarUrl,
                    bannerUrl: communities.bannerUrl,
                    creatorId: communities.creatorId,
                    createdAt: communities.createdAt,
                });

            return reply.send({
                community: {
                    ...community,
                    isMember: true,
                    viewerRole: access.membership?.role ?? null,
                },
            });
        }
    );

    app.delete<{ Params: { slug: string } }>(
        "/communities/:slug",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!access.canDelete) return reply.status(403).send({ error: "Only the owner can delete a community" });

            await db.delete(communities).where(eq(communities.id, access.community.id));
            return reply.status(204).send();
        }
    );

    app.get<{ Params: { slug: string } }>(
        "/communities/:slug/members",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!access.canView) return reply.status(403).send({ error: "Community is private" });

            const members = await db
                .select({
                    userId: users.id,
                    username: users.username,
                    profilePic: users.profilePic,
                    bio: users.bio,
                    role: communityMembers.role,
                    joinedAt: communityMembers.joinedAt,
                })
                .from(communityMembers)
                .innerJoin(users, eq(communityMembers.userId, users.id))
                .where(eq(communityMembers.communityId, access.community.id))
                .orderBy(
                    sql`CASE
                        WHEN ${communityMembers.role} = 'owner' THEN 0
                        WHEN ${communityMembers.role} = 'moderator' THEN 1
                        ELSE 2
                    END`,
                    asc(users.username)
                );

            return reply.send({
                members,
                count: members.length,
            });
        }
    );

    app.get<{ Params: { slug: string } }>(
        "/communities/:slug/requests",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!hasCommunityRole(access, "moderator")) {
                return reply.status(403).send({ error: "Moderator role required" });
            }

            const requests = await db
                .select({
                    userId: users.id,
                    username: users.username,
                    profilePic: users.profilePic,
                    bio: users.bio,
                    requestedAt: communityJoinRequests.createdAt,
                })
                .from(communityJoinRequests)
                .innerJoin(users, eq(communityJoinRequests.userId, users.id))
                .where(eq(communityJoinRequests.communityId, access.community.id))
                .orderBy(desc(communityJoinRequests.createdAt));

            return reply.send({ requests });
        }
    );

    app.get<{ Params: { slug: string } }>(
        "/communities/:slug/invites",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!hasCommunityRole(access, "moderator")) {
                return reply.status(403).send({ error: "Moderator role required" });
            }

            const invites = await db
                .select({
                    userId: communityInvites.invitedUserId,
                    username: users.username,
                    profilePic: users.profilePic,
                    bio: users.bio,
                    invitedAt: communityInvites.createdAt,
                })
                .from(communityInvites)
                .innerJoin(users, eq(communityInvites.invitedUserId, users.id))
                .where(eq(communityInvites.communityId, access.community.id))
                .orderBy(desc(communityInvites.createdAt));

            return reply.send({ invites });
        }
    );

    app.post<{ Params: { slug: string } }>(
        "/communities/:slug/invites",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!hasCommunityRole(access, "moderator")) {
                return reply.status(403).send({ error: "Moderator role required" });
            }

            const body = CreateInviteSchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });
            }

            const [targetUser] = await db
                .select({ id: users.id, username: users.username, profilePic: users.profilePic, bio: users.bio, rejectCommunityInvites: users.rejectCommunityInvites })
                .from(users)
                .where(eq(users.username, body.data.username.toLowerCase()))
                .limit(1);

            if (!targetUser) return reply.status(404).send({ error: "User not found" });
            if (targetUser.rejectCommunityInvites) return reply.status(409).send({ error: "User does not accept community invites" });

            const [member] = await db
                .select({ userId: communityMembers.userId })
                .from(communityMembers)
                .where(and(eq(communityMembers.communityId, access.community.id), eq(communityMembers.userId, targetUser.id)))
                .limit(1);

            if (member) return reply.status(409).send({ error: "User is already a member" });

            await db.transaction(async (tx) => {
                await tx
                    .insert(communityInvites)
                    .values({
                        communityId: access.community.id,
                        invitedUserId: targetUser.id,
                        inviterUserId: userId,
                    })
                    .onConflictDoUpdate({
                        target: [communityInvites.communityId, communityInvites.invitedUserId],
                        set: {
                            inviterUserId: userId,
                            createdAt: new Date(),
                        },
                    });

                // An active invite supersedes a pending join request for the same user.
                await tx
                    .delete(communityJoinRequests)
                    .where(and(eq(communityJoinRequests.communityId, access.community.id), eq(communityJoinRequests.userId, targetUser.id)));

                await tx
                    .update(notifications)
                    .set({
                        actionStatus: "accepted",
                        resolvedAt: new Date(),
                        isRead: true,
                    })
                    .where(
                        and(
                            eq(notifications.communityId, access.community.id),
                            eq(notifications.actorId, targetUser.id),
                            eq(notifications.type, "community_join_request"),
                            sql`${notifications.actionStatus} IS NULL`
                        )
                    );

                await tx.insert(notifications).values({
                    userId: targetUser.id,
                    actorId: userId,
                    type: "community_invite",
                    communityId: access.community.id,
                });
            });

            publishNotificationEvent({
                event: "notification:new",
                userId: targetUser.id,
                actorId: userId,
                notificationType: "community_invite",
                communitySlug: access.community.slug,
                at: new Date().toISOString(),
            });

            return reply.status(201).send({
                invite: {
                    communityId: access.community.id,
                    userId: targetUser.id,
                    username: targetUser.username,
                    profilePic: targetUser.profilePic,
                    bio: targetUser.bio,
                },
            });
        }
    );

    app.delete<{ Params: { slug: string } }>(
        "/communities/:slug/invites/me",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });

            const result = await db
                .delete(communityInvites)
                .where(and(eq(communityInvites.communityId, access.community.id), eq(communityInvites.invitedUserId, userId)));

            if (!result.rowCount) return reply.status(404).send({ error: "Invite not found" });
            return reply.status(204).send();
        }
    );

    app.delete<{ Params: { slug: string; invitedUserId: string } }>(
        "/communities/:slug/invites/:invitedUserId",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!hasCommunityRole(access, "moderator")) {
                return reply.status(403).send({ error: "Moderator role required" });
            }

            const result = await db
                .delete(communityInvites)
                .where(and(eq(communityInvites.communityId, access.community.id), eq(communityInvites.invitedUserId, request.params.invitedUserId)));

            if (!result.rowCount) return reply.status(404).send({ error: "Invite not found" });
            return reply.status(204).send();
        }
    );

    app.post<{ Params: { slug: string; requestUserId: string } }>(
        "/communities/:slug/requests/:requestUserId/approve",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!hasCommunityRole(access, "moderator")) {
                return reply.status(403).send({ error: "Moderator role required" });
            }

            const targetUserId = request.params.requestUserId;
            const [pending] = await db
                .select({ userId: communityJoinRequests.userId })
                .from(communityJoinRequests)
                .where(and(eq(communityJoinRequests.communityId, access.community.id), eq(communityJoinRequests.userId, targetUserId)))
                .limit(1);

            if (!pending) return reply.status(404).send({ error: "Join request not found" });

            await db.transaction(async (tx) => {
                const inserted = await tx
                    .insert(communityMembers)
                    .values({ communityId: access.community.id, userId: targetUserId, role: "member" })
                    .onConflictDoNothing();

                if (inserted.rowCount && inserted.rowCount > 0) {
                    const [updatedCommunity] = await tx
                        .update(communities)
                        .set({ memberCount: sql`${communities.memberCount} + 1` })
                        .where(eq(communities.id, access.community.id))
                        .returning({ memberCount: communities.memberCount });

                    await maybeInsertCommunityMilestonePost(
                        tx,
                        access.community.id,
                        userId,
                        access.community.slug,
                        updatedCommunity.memberCount
                    );
                }

                await tx
                    .delete(communityJoinRequests)
                    .where(and(eq(communityJoinRequests.communityId, access.community.id), eq(communityJoinRequests.userId, targetUserId)));
                await tx
                    .delete(communityInvites)
                    .where(and(eq(communityInvites.communityId, access.community.id), eq(communityInvites.invitedUserId, targetUserId)));
            });

            return reply.send({ approved: true, userId: targetUserId });
        }
    );

    app.delete<{ Params: { slug: string; requestUserId: string } }>(
        "/communities/:slug/requests/:requestUserId",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!hasCommunityRole(access, "moderator")) {
                return reply.status(403).send({ error: "Moderator role required" });
            }

            const result = await db
                .delete(communityJoinRequests)
                .where(and(eq(communityJoinRequests.communityId, access.community.id), eq(communityJoinRequests.userId, request.params.requestUserId)));

            if (!result.rowCount) return reply.status(404).send({ error: "Join request not found" });
            return reply.status(204).send();
        }
    );

    app.patch<{ Params: { slug: string; memberUserId: string } }>(
        "/communities/:slug/members/:memberUserId/role",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!access.canManage) return reply.status(403).send({ error: "Only the owner can update member roles" });

            const body = UpdateMemberRoleSchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });
            }

            const { memberUserId } = request.params;
            if (memberUserId === userId) {
                return reply.status(400).send({ error: "Owner role changes must be handled separately" });
            }

            const [targetMembership] = await db
                .select({ role: communityMembers.role })
                .from(communityMembers)
                .where(and(eq(communityMembers.communityId, access.community.id), eq(communityMembers.userId, memberUserId)))
                .limit(1);

            if (!targetMembership) {
                return reply.status(404).send({ error: "Member not found" });
            }

            if (targetMembership.role === "owner") {
                return reply.status(400).send({ error: "Owner role cannot be reassigned from this endpoint" });
            }

            const [membership] = await db
                .update(communityMembers)
                .set({ role: body.data.role })
                .where(and(eq(communityMembers.communityId, access.community.id), eq(communityMembers.userId, memberUserId)))
                .returning({
                    communityId: communityMembers.communityId,
                    userId: communityMembers.userId,
                    role: communityMembers.role,
                    joinedAt: communityMembers.joinedAt,
                });

            return reply.send({ membership });
        }
    );

    app.get<{ Params: { slug: string } }>(
        "/communities/:slug/rules",
        { preHandler: app.optionalAuth },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!access.canView) return reply.status(403).send({ error: "Community is private" });

            const rules = await db
                .select({
                    id: communityRules.id,
                    title: communityRules.title,
                    description: communityRules.description,
                    sortOrder: communityRules.sortOrder,
                    createdAt: communityRules.createdAt,
                    createdBy: communityRules.createdBy,
                })
                .from(communityRules)
                .where(eq(communityRules.communityId, access.community.id))
                .orderBy(asc(communityRules.sortOrder), asc(communityRules.createdAt));

            return reply.send({ rules });
        }
    );

    app.post<{ Params: { slug: string } }>(
        "/communities/:slug/rules",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!hasCommunityRole(access, "moderator")) {
                return reply.status(403).send({ error: "Moderator role required" });
            }

            const body = UpsertRuleSchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });
            }

            const [rule] = await db
                .insert(communityRules)
                .values({
                    communityId: access.community.id,
                    title: body.data.title,
                    description: body.data.description,
                    sortOrder: body.data.sortOrder ?? 0,
                    createdBy: userId,
                })
                .returning();

            return reply.status(201).send({ rule });
        }
    );

    app.patch<{ Params: { slug: string; ruleId: string } }>(
        "/communities/:slug/rules/:ruleId",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!hasCommunityRole(access, "moderator")) {
                return reply.status(403).send({ error: "Moderator role required" });
            }

            const body = UpsertRuleSchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });
            }

            const [rule] = await db
                .update(communityRules)
                .set({
                    title: body.data.title,
                    description: body.data.description,
                    sortOrder: body.data.sortOrder ?? 0,
                })
                .where(and(eq(communityRules.id, request.params.ruleId), eq(communityRules.communityId, access.community.id)))
                .returning();

            if (!rule) return reply.status(404).send({ error: "Rule not found" });
            return reply.send({ rule });
        }
    );

    app.delete<{ Params: { slug: string; ruleId: string } }>(
        "/communities/:slug/rules/:ruleId",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!hasCommunityRole(access, "moderator")) {
                return reply.status(403).send({ error: "Moderator role required" });
            }

            const result = await db
                .delete(communityRules)
                .where(and(eq(communityRules.id, request.params.ruleId), eq(communityRules.communityId, access.community.id)));

            if (!result.rowCount) return reply.status(404).send({ error: "Rule not found" });
            return reply.status(204).send();
        }
    );

    app.post<{ Params: { slug: string } }>(
        "/communities/:slug/join",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (access.isMember) {
                return reply.status(200).send({
                    joined: access.community.slug,
                    isMember: true,
                });
            }

            const [invite, existingRequest] = await Promise.all([
                db
                    .select({ communityId: communityInvites.communityId })
                    .from(communityInvites)
                    .where(and(eq(communityInvites.communityId, access.community.id), eq(communityInvites.invitedUserId, userId)))
                    .limit(1)
                    .then((rows) => rows[0] ?? null),
                db
                    .select({ communityId: communityJoinRequests.communityId })
                    .from(communityJoinRequests)
                    .where(and(eq(communityJoinRequests.communityId, access.community.id), eq(communityJoinRequests.userId, userId)))
                    .limit(1)
                    .then((rows) => rows[0] ?? null),
            ]);

            if (!invite) {
                const createdRequest = !existingRequest;
                if (createdRequest) {
                    await db
                        .insert(communityJoinRequests)
                        .values({ communityId: access.community.id, userId })
                        .onConflictDoNothing();

                    const moderators = await db
                        .select({ userId: communityMembers.userId })
                        .from(communityMembers)
                        .where(
                            and(
                                eq(communityMembers.communityId, access.community.id),
                                sql`${communityMembers.role} IN ('owner', 'moderator')`
                            )
                        );

                    const moderatorIds = moderators.map((row) => row.userId).filter((id) => id !== userId);
                    if (moderatorIds.length > 0) {
                        await db.insert(notifications).values(
                            moderatorIds.map((moderatorId) => ({
                                userId: moderatorId,
                                actorId: userId,
                                type: "community_join_request" as const,
                                communityId: access.community.id,
                            }))
                        );

                        const at = new Date().toISOString();
                        for (const moderatorId of moderatorIds) {
                            publishNotificationEvent({
                                event: "notification:new",
                                userId: moderatorId,
                                actorId: userId,
                                notificationType: "community_join_request",
                                communitySlug: access.community.slug,
                                at,
                            });
                        }
                    }
                }

                return reply.status(existingRequest ? 200 : 202).send({
                    requested: true,
                    isMember: false,
                    communitySlug: access.community.slug,
                });
            }

            const insertResult = await db.transaction(async (tx) => {
                const inserted = await tx
                    .insert(communityMembers)
                    .values({ communityId: access.community.id, userId, role: "member" })
                    .onConflictDoNothing();

                if (inserted.rowCount && inserted.rowCount > 0) {
                    const [updatedCommunity] = await tx
                        .update(communities)
                        .set({ memberCount: sql`${communities.memberCount} + 1` })
                        .where(eq(communities.id, access.community.id))
                        .returning({ memberCount: communities.memberCount });

                    await maybeInsertCommunityMilestonePost(
                        tx,
                        access.community.id,
                        userId,
                        access.community.slug,
                        updatedCommunity.memberCount
                    );
                }

                await tx
                    .delete(communityInvites)
                    .where(and(eq(communityInvites.communityId, access.community.id), eq(communityInvites.invitedUserId, userId)));
                await tx
                    .delete(communityJoinRequests)
                    .where(and(eq(communityJoinRequests.communityId, access.community.id), eq(communityJoinRequests.userId, userId)));

                return inserted;
            });

            return reply.status(insertResult.rowCount && insertResult.rowCount > 0 ? 201 : 200).send({
                joined: access.community.slug,
                isMember: true,
                acceptedInvite: Boolean(invite),
            });
        }
    );

    app.post<{ Params: { slug: string } }>(
        "/communities/:slug/posts",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!access.canPost) return reply.status(403).send({ error: "You must be a member to post in this community" });

            const body = CreatePostSchema.safeParse(request.body);
            if (!body.success) {
                return reply.status(400).send({ error: "Validation failed", details: body.error.flatten() });
            }

            if (body.data.parentId) {
                const parentCommunity = await db
                    .select({ communityId: postCommunities.communityId })
                    .from(postCommunities)
                    .where(eq(postCommunities.postId, body.data.parentId))
                    .limit(1)
                    .then((rows) => rows[0] ?? null);

                if (!parentCommunity || parentCommunity.communityId !== access.community.id) {
                    return reply.status(400).send({ error: "Community replies and reposts must target a post in the same community" });
                }
            }

            const result = await createPostForUser({
                userId,
                communityId: access.community.id,
                post: body.data,
                redis: app.redis,
            });

            if (result.status === 201) {
                try {
                    await incrementCounter(app.redis, "posts_created");
                } catch (error) {
                    app.log.warn({ err: error }, "Failed to track community post metric");
                }
            }

            if ("notifyUserId" in result.body) {
                const { notifyUserId, ...publicBody } = result.body;
                return reply.status(result.status).send({
                    ...publicBody,
                    community: {
                        id: access.community.id,
                        slug: access.community.slug,
                    },
                });
            }

            return reply.status(result.status).send(result.body);
        }
    );

    app.delete<{ Params: { slug: string } }>(
        "/communities/:slug/join",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (access.membership?.role === "owner") {
                return reply.status(400).send({ error: "Owner must delete or transfer the community before leaving" });
            }

            const deleteResult = await db
                .delete(communityMembers)
                .where(and(eq(communityMembers.communityId, access.community.id), eq(communityMembers.userId, userId)));

            if (deleteResult.rowCount && deleteResult.rowCount > 0) {
                await db
                    .update(communities)
                    .set({ memberCount: sql`GREATEST(0, ${communities.memberCount} - 1)` })
                    .where(eq(communities.id, access.community.id));
            }

            return reply.status(204).send();
        }
    );

    app.post<{ Params: { slug: string; postId: string } }>(
        "/communities/:slug/posts/:postId",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const { postId } = request.params;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!access.canPost) return reply.status(403).send({ error: "You are not a member" });

            const [post] = await db
                .select({ id: posts.id, userId: posts.userId })
                .from(posts)
                .where(eq(posts.id, postId))
                .limit(1);

            if (!post) return reply.status(404).send({ error: "Post not found" });
            if (post.userId !== userId && !access.canModerate) {
                return reply.status(403).send({ error: "You can only tag your own posts into this community" });
            }

            const existingTags = await db
                .select({ communityId: postCommunities.communityId })
                .from(postCommunities)
                .where(eq(postCommunities.postId, postId))
                .limit(2);

            if (existingTags.length > 0 && !existingTags.some((tag) => tag.communityId === access.community.id)) {
                return reply.status(409).send({ error: "Post is already attached to another community" });
            }

            await db
                .insert(postCommunities)
                .values({ communityId: access.community.id, postId })
                .onConflictDoNothing();

            return reply.status(201).send({ tagged: true, communitySlug: access.community.slug, postId });
        }
    );

    app.delete<{ Params: { slug: string; postId: string } }>(
        "/communities/:slug/posts/:postId",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = (request as AuthRequest).userId;
            const { postId } = request.params;
            const access = await getCommunityAccessBySlug(request.params.slug, userId);

            if (!access) return reply.status(404).send({ error: "Community not found" });
            if (!hasCommunityRole(access, "moderator")) {
                return reply.status(403).send({ error: "Moderator role required" });
            }

            const result = await db
                .delete(postCommunities)
                .where(and(eq(postCommunities.communityId, access.community.id), eq(postCommunities.postId, postId)));

            if (!result.rowCount) return reply.status(404).send({ error: "Tagged post not found" });
            return reply.status(204).send();
        }
    );
}
