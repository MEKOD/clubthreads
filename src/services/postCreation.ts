import { z } from "zod";
import { db } from "../db";
import { communityMembers, notifications, pollOptions, polls, posts, postCommunities, users } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";
import { publishNotificationEvent } from "./notificationHub";
import { hydratePostLinkPreview } from "./linkPreview";
import { maybeQueueAiBotReply, type AiBotRedisLike } from "./aiBot";

export const CreatePostSchema = z.object({
    content: z.string().min(1).max(4000).optional(),
    mediaUrl: z.string().min(1).optional(),
    mediaMimeType: z.string().optional(),
    parentId: z.string().uuid().optional(),
    type: z.enum(["post", "rt", "quote"]).default("post"),
    poll: z.object({
        options: z.array(z.string().min(1).max(120)).min(2).max(4),
        durationHours: z.number().min(1).max(168).default(24),
    }).optional(),
}).refine((d) => {
    if (d.type === "rt") return Boolean(d.parentId);
    return Boolean(d.content || d.mediaUrl || d.poll);
}, {
    message: "Post must have content, media, or a poll. Reposts require a parent post.",
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>;

export async function createPostForUser(input: {
    userId: string;
    post: CreatePostInput;
    communityId?: string;
    redis?: AiBotRedisLike;
    skipBotReply?: boolean;
}) {
    const { userId, post: payload, communityId, redis, skipBotReply } = input;
    const { content, mediaUrl, mediaMimeType, parentId, type, poll } = payload;

    const result = await db.transaction(async (tx) => {
        let parentOwnerId: string | null = null;
        let parentCommunityId: string | null = null;

        if (parentId) {
            const [parent] = await tx
                .select({ id: posts.id, userId: posts.userId, communityId: postCommunities.communityId })
                .from(posts)
                .leftJoin(postCommunities, eq(postCommunities.postId, posts.id))
                .where(eq(posts.id, parentId))
                .limit(1);

            if (!parent) {
                return { status: 404 as const, body: { error: "Parent post not found" } };
            }

            parentOwnerId = parent.userId;
            parentCommunityId = parent.communityId ?? null;

            if (communityId && parentCommunityId && communityId !== parentCommunityId) {
                return { status: 400 as const, body: { error: "Replies and reposts must stay in the same community scope" } };
            }
        }

        const effectiveCommunityId = communityId ?? parentCommunityId ?? undefined;

        if (effectiveCommunityId) {
            const [membership] = await tx
                .select({ communityId: communityMembers.communityId })
                .from(communityMembers)
                .where(and(eq(communityMembers.communityId, effectiveCommunityId), eq(communityMembers.userId, userId)))
                .limit(1);

            if (!membership) {
                return { status: 403 as const, body: { error: "You must be a member of this community" } };
            }
        }

        const [createdPost] = await tx
            .insert(posts)
            .values({
                userId,
                content: content ?? null,
                mediaUrl: mediaUrl ?? null,
                mediaMimeType: mediaMimeType ?? null,
                parentId: parentId ?? null,
                type,
            })
            .returning();

        if (effectiveCommunityId) {
            await tx.insert(postCommunities).values({
                postId: createdPost.id,
                communityId: effectiveCommunityId,
            });
        }

        if (poll) {
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + poll.durationHours);

            const [createdPoll] = await tx
                .insert(polls)
                .values({
                    postId: createdPost.id,
                    expiresAt,
                })
                .returning();

            await tx.insert(pollOptions).values(
                poll.options.map((opt) => ({
                    pollId: createdPoll.id,
                    text: opt,
                }))
            );
        }

        if (parentId) {
            const isRepostFamily = type === "rt" || type === "quote";
            const field = isRepostFamily ? posts.rtCount : posts.replyCount;
            await tx
                .update(posts)
                .set({ [isRepostFamily ? "rtCount" : "replyCount"]: sql`${field} + 1` })
                .where(eq(posts.id, parentId));

            if (parentOwnerId && parentOwnerId !== userId) {
                const notifType = type === "post" ? "reply" : type as "rt" | "quote";
                await tx.insert(notifications).values({
                    userId: parentOwnerId,
                    actorId: userId,
                    type: notifType,
                    postId: createdPost.id,
                });
            }
        }

        return {
            status: 201 as const,
            body: {
                post: createdPost,
                notifyUserId: parentOwnerId,
            },
        };
    });

    if ("notifyUserId" in result.body && result.body.notifyUserId && result.body.notifyUserId !== userId && parentId) {
        const notifType = type === "post" ? "reply" : type as "rt" | "quote";
        publishNotificationEvent({
            event: "notification:new",
            userId: result.body.notifyUserId,
            actorId: userId,
            postId: result.body.post.id,
            notificationType: notifType,
            at: new Date().toISOString(),
        });
    }

    try {
        const postContent = content ?? "";
        const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
        const mentionMatches = [...postContent.matchAll(mentionRegex)].map((m) => m[1].toLowerCase());
        const uniqueMentions = [...new Set(mentionMatches)];

        if (uniqueMentions.length > 0 && "post" in result.body && result.body.post) {
            const parentOwnerId = "notifyUserId" in result.body ? result.body.notifyUserId : null;
            const createdPostId = result.body.post.id;

            const mentionedUsers = await db
                .select({ id: users.id, username: users.username })
                .from(users)
                .where(sql`LOWER(${users.username}) IN (${sql.join(uniqueMentions.map((u) => sql`${u}`), sql`, `)})`);

            const mentionNotifs = mentionedUsers.filter((u) => u.id !== userId && u.id !== parentOwnerId);

            if (mentionNotifs.length > 0) {
                await db.insert(notifications).values(
                    mentionNotifs.map((mentioned) => ({
                        userId: mentioned.id,
                        actorId: userId,
                        type: "mention" as const,
                        postId: createdPostId,
                    }))
                );

                const publishedAt = new Date().toISOString();
                for (const mentioned of mentionNotifs) {
                    publishNotificationEvent({
                        event: "notification:new",
                        userId: mentioned.id,
                        actorId: userId,
                        postId: createdPostId,
                        notificationType: "mention",
                        at: publishedAt,
                    });
                }
            }
        }
    } catch {
        // Mention delivery must not fail post creation.
    }

    const createdPost = "post" in result.body ? result.body.post : null;
    if (createdPost) {
        void hydratePostLinkPreview(createdPost.id, content).catch((error) => {
            console.warn(`[linkPreview] post ${createdPost.id} failed: ${(error as Error).message}`);
        });

        if (!skipBotReply) {
            void maybeQueueAiBotReply({
                redis,
                sourcePostId: createdPost.id,
                sourceUserId: userId,
                content,
                parentId,
                communityId: communityId ?? undefined,
            }).catch((error) => {
                console.warn(`[aiBot] post ${createdPost.id} failed: ${(error as Error).message}`);
            });
        }
    }

    return result;
}
