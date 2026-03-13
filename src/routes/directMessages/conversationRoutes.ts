import { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { blocks, directMessages, directThreads, follows, users } from "../../db/schema";
import type { AuthRequest } from "../../plugins/auth";
import {
    buildConversationStateFromThread,
    buildConversationSummary,
    buildFriendSummary,
    extractDmPublicKey,
    getOtherLastDeliveredSequence,
    getOtherLastSeenSequence,
    getThreadLastMessageSequence,
    getViewerLastDeliveredSequence,
    getViewerLastReadAt,
    getViewerLastSeenSequence,
    getViewerUnreadCount,
    normalizeThreadPair,
} from "./helpers";
import {
    ConversationListQuerySchema,
    ConversationMessagesQuerySchema,
    FriendsQuerySchema,
    StartConversationSchema,
} from "./schemas";
import {
    advanceDeliveredSequence,
    applyThreadState,
    getThreadContext,
    getUnreadCount,
    hasMutualBlock,
    publishDeliveredReceipt,
} from "./queries";
import type {
    ConversationListRow,
    FriendRow,
    ThreadContextRow,
} from "./types";

export function registerDirectMessageConversationRoutes(app: FastifyInstance) {
    app.get<{ Querystring: { limit?: string } }>(
        "/dm/friends",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const parsed = FriendsQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid friends query", details: parsed.error.flatten() });
            }

            const limit = Math.min(30, Math.max(1, parseInt(parsed.data.limit ?? "12", 10)));

            const rows = await db.execute<FriendRow>(sql`
                WITH mutuals AS (
                    SELECT
                        u.id AS "userId",
                        u.username AS "username",
                        u.profile_pic AS "profilePic",
                        u.bio AS "bio",
                        u.role AS "role",
                        GREATEST(outbound.created_at, inbound.created_at) AS "connectedAt"
                    FROM ${follows} outbound
                    INNER JOIN ${follows} inbound
                        ON inbound.follower_id = outbound.following_id
                       AND inbound.following_id = outbound.follower_id
                    INNER JOIN ${users} u
                        ON u.id = outbound.following_id
                    WHERE outbound.follower_id = ${userId}
                      AND u.is_active = true
                      AND NOT EXISTS (
                        SELECT 1
                        FROM ${blocks} b
                        WHERE (
                            b.blocker_id = ${userId}
                            AND b.blocked_id = u.id
                        ) OR (
                            b.blocker_id = u.id
                            AND b.blocked_id = ${userId}
                        )
                      )
                )
                SELECT
                    m."userId" AS "userId",
                    m."username" AS "username",
                    m."profilePic" AS "profilePic",
                    m."bio" AS "bio",
                    m."role" AS "role",
                    m."connectedAt" AS "connectedAt",
                    dt.id AS "conversationId",
                    dt.last_message_at AS "lastMessageAt",
                    CASE
                        WHEN dt.id IS NULL THEN 0
                        WHEN dt.user_a_id = ${userId} THEN dt.user_a_unread_count
                        ELSE dt.user_b_unread_count
                    END AS "unreadCount"
                FROM mutuals m
                LEFT JOIN ${directThreads} dt
                    ON (
                        (dt.user_a_id = ${userId} AND dt.user_b_id = m."userId")
                        OR
                        (dt.user_b_id = ${userId} AND dt.user_a_id = m."userId")
                    )
                ORDER BY COALESCE(dt.last_message_at, m."connectedAt") DESC
                LIMIT ${limit}
            `);

            return reply.send({ friends: rows.rows.map(buildFriendSummary) });
        }
    );

    app.get<{ Querystring: { page?: string; limit?: string } }>(
        "/dm/conversations",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const parsed = ConversationListQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid conversation query", details: parsed.error.flatten() });
            }

            const page = Math.max(1, parseInt(parsed.data.page ?? "1", 10));
            const limit = Math.min(50, Math.max(1, parseInt(parsed.data.limit ?? "20", 10)));
            const offset = (page - 1) * limit;

            const rows = await db.execute<ConversationListRow>(sql`
                WITH viewer_threads AS (
                    SELECT
                        dt.id,
                        dt.created_at AS "createdAt",
                        dt.last_message_at AS "lastMessageAt",
                        dt.last_message_id AS "lastMessageId",
                        dt.last_message_sequence AS "lastMessageSequence",
                        CASE WHEN dt.user_a_id = ${userId} THEN dt.user_b_id ELSE dt.user_a_id END AS "otherUserId",
                        CASE WHEN dt.user_a_id = ${userId} THEN dt.user_a_unread_count ELSE dt.user_b_unread_count END AS "viewerUnreadCount",
                        CASE WHEN dt.user_a_id = ${userId} THEN dt.user_a_last_delivered_sequence ELSE dt.user_b_last_delivered_sequence END AS "viewerLastDeliveredSequence",
                        CASE WHEN dt.user_a_id = ${userId} THEN dt.user_a_last_seen_sequence ELSE dt.user_b_last_seen_sequence END AS "viewerLastSeenSequence",
                        CASE WHEN dt.user_a_id = ${userId} THEN dt.user_b_last_delivered_sequence ELSE dt.user_a_last_delivered_sequence END AS "otherLastDeliveredSequence",
                        CASE WHEN dt.user_a_id = ${userId} THEN dt.user_b_last_seen_sequence ELSE dt.user_a_last_seen_sequence END AS "otherLastSeenSequence"
                    FROM ${directThreads} dt
                    WHERE dt.user_a_id = ${userId} OR dt.user_b_id = ${userId}
                )
                SELECT
                    vt.id AS "id",
                    vt."createdAt" AS "createdAt",
                    vt."lastMessageAt" AS "lastMessageAt",
                    vt."lastMessageSequence" AS "lastMessageSequence",
                    u.id AS "otherUserId",
                    u.username AS "otherUsername",
                    u.profile_pic AS "otherProfilePic",
                    u.bio AS "otherBio",
                    u.role AS "otherRole",
                    u.dm_crypto AS "otherDmCrypto",
                    (
                        EXISTS (
                            SELECT 1
                            FROM ${follows} outbound
                            WHERE outbound.follower_id = ${userId}
                              AND outbound.following_id = u.id
                        )
                        AND
                        EXISTS (
                            SELECT 1
                            FROM ${follows} inbound
                            WHERE inbound.follower_id = u.id
                              AND inbound.following_id = ${userId}
                        )
                    ) AS "canMessage",
                    lm.id AS "lastMessageId",
                    lm.sender_id AS "lastMessageSenderId",
                    lm.content AS "lastMessageContent",
                    lm.encrypted_payload AS "lastMessageEncryptedPayload",
                    lm.media_url AS "lastMessageMediaUrl",
                    lm.media_mime_type AS "lastMessageMediaMimeType",
                    lm.created_at AS "lastMessageCreatedAt",
                    COALESCE(vt."viewerLastDeliveredSequence", 0) AS "viewerLastDeliveredSequence",
                    COALESCE(vt."viewerLastSeenSequence", 0) AS "viewerLastSeenSequence",
                    COALESCE(vt."otherLastDeliveredSequence", 0) AS "otherLastDeliveredSequence",
                    COALESCE(vt."otherLastSeenSequence", 0) AS "otherLastSeenSequence",
                    COALESCE(vt."viewerUnreadCount", 0) AS "unreadCount"
                FROM viewer_threads vt
                INNER JOIN ${users} u ON u.id = vt."otherUserId"
                LEFT JOIN LATERAL (
                    SELECT
                        dm.id,
                        dm.sender_id,
                        dm.content,
                        dm.encrypted_payload,
                        dm.media_url,
                        dm.media_mime_type,
                        dm.created_at
                    FROM ${directMessages} dm
                    WHERE dm.id = vt."lastMessageId"
                    LIMIT 1
                ) lm ON true
                WHERE u.is_active = true
                  AND NOT EXISTS (
                    SELECT 1
                    FROM ${blocks} b
                    WHERE (
                        b.blocker_id = ${userId}
                        AND b.blocked_id = u.id
                    ) OR (
                        b.blocker_id = u.id
                        AND b.blocked_id = ${userId}
                    )
                  )
                ORDER BY COALESCE(lm.created_at, vt."lastMessageAt") DESC
                LIMIT ${limit}
                OFFSET ${offset}
            `);

            return reply.send({
                conversations: rows.rows.map(buildConversationSummary),
                unreadCount: await getUnreadCount(userId),
                page,
                hasMore: rows.rows.length === limit,
            });
        }
    );

    app.post<{ Body: { username: string; includeMessages?: boolean; messageLimit?: number } }>(
        "/dm/conversations",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId, username } = request as AuthRequest;
            const body = StartConversationSchema.safeParse(request.body);

            if (!body.success) {
                return reply.status(400).send({ error: "Invalid conversation payload", details: body.error.flatten() });
            }

            const normalizedUsername = body.data.username.toLowerCase();

            const result = await db.transaction(async (tx) => {
                const [target] = await tx
                    .select({
                        id: users.id,
                        username: users.username,
                        profilePic: users.profilePic,
                        bio: users.bio,
                        role: users.role,
                        dmCrypto: users.dmCrypto,
                        isActive: users.isActive,
                    })
                    .from(users)
                    .where(eq(users.username, normalizedUsername))
                    .limit(1);

                if (!target) {
                    return { status: 404 as const, body: { error: "User not found" } };
                }

                if (!target.isActive) {
                    return { status: 410 as const, body: { error: "Account suspended" } };
                }

                if (target.id === userId) {
                    return { status: 400 as const, body: { error: "You cannot message yourself" } };
                }

                const [blocked] = await tx
                    .select({ blockerId: blocks.blockerId })
                    .from(blocks)
                    .where(sql`
                        (${blocks.blockerId} = ${userId} AND ${blocks.blockedId} = ${target.id})
                        OR
                        (${blocks.blockerId} = ${target.id} AND ${blocks.blockedId} = ${userId})
                    `)
                    .limit(1);

                if (blocked) {
                    return { status: 403 as const, body: { error: "You cannot message this user" } };
                }

                const [userAId, userBId] = normalizeThreadPair(userId, target.id);
                const now = new Date();

                const [existingThread] = await tx
                    .select({
                        id: directThreads.id,
                        createdAt: directThreads.createdAt,
                        lastMessageAt: directThreads.lastMessageAt,
                        lastMessageId: directThreads.lastMessageId,
                        lastMessageSequence: directThreads.lastMessageSequence,
                        userAId: directThreads.userAId,
                        userBId: directThreads.userBId,
                        userALastReadAt: directThreads.userALastReadAt,
                        userBLastReadAt: directThreads.userBLastReadAt,
                        userAUnreadCount: directThreads.userAUnreadCount,
                        userBUnreadCount: directThreads.userBUnreadCount,
                        userALastDeliveredSequence: directThreads.userALastDeliveredSequence,
                        userBLastDeliveredSequence: directThreads.userBLastDeliveredSequence,
                        userALastSeenSequence: directThreads.userALastSeenSequence,
                        userBLastSeenSequence: directThreads.userBLastSeenSequence,
                        nextSequence: directThreads.nextSequence,
                    })
                    .from(directThreads)
                    .where(and(eq(directThreads.userAId, userAId), eq(directThreads.userBId, userBId)))
                    .limit(1);

                const [viewerFollows, targetFollows] = await Promise.all([
                    tx
                        .select({ followerId: follows.followerId })
                        .from(follows)
                        .where(and(eq(follows.followerId, userId), eq(follows.followingId, target.id)))
                        .limit(1),
                    tx
                        .select({ followerId: follows.followerId })
                        .from(follows)
                        .where(and(eq(follows.followerId, target.id), eq(follows.followingId, userId)))
                        .limit(1),
                ]);

                const canMessage = viewerFollows.length > 0 && targetFollows.length > 0;

                if (!existingThread && !canMessage) {
                    return { status: 403 as const, body: { error: "Karsilikli takip olmadan DM acamazsin" } };
                }

                if (!existingThread) {
                    await tx
                        .insert(directThreads)
                        .values({
                            userAId,
                            userBId,
                            userALastReadAt: now,
                            userBLastReadAt: now,
                            userAUnreadCount: 0,
                            userBUnreadCount: 0,
                            userALastDeliveredSequence: 0,
                            userBLastDeliveredSequence: 0,
                            userALastSeenSequence: 0,
                            userBLastSeenSequence: 0,
                            nextSequence: 1,
                            lastMessageSequence: 0,
                            lastMessageAt: now,
                        })
                        .onConflictDoNothing();
                }

                const [thread] = await tx
                    .select({
                        id: directThreads.id,
                        createdAt: directThreads.createdAt,
                        lastMessageAt: directThreads.lastMessageAt,
                        lastMessageId: directThreads.lastMessageId,
                        lastMessageSequence: directThreads.lastMessageSequence,
                        userAId: directThreads.userAId,
                        userBId: directThreads.userBId,
                        userALastReadAt: directThreads.userALastReadAt,
                        userBLastReadAt: directThreads.userBLastReadAt,
                        userAUnreadCount: directThreads.userAUnreadCount,
                        userBUnreadCount: directThreads.userBUnreadCount,
                        userALastDeliveredSequence: directThreads.userALastDeliveredSequence,
                        userBLastDeliveredSequence: directThreads.userBLastDeliveredSequence,
                        userALastSeenSequence: directThreads.userALastSeenSequence,
                        userBLastSeenSequence: directThreads.userBLastSeenSequence,
                        nextSequence: directThreads.nextSequence,
                    })
                    .from(directThreads)
                    .where(and(eq(directThreads.userAId, userAId), eq(directThreads.userBId, userBId)))
                    .limit(1);

                if (!thread) {
                    return { status: 500 as const, body: { error: "Conversation could not be created" } };
                }

                const [lastMessage] = await tx
                    .select({
                        id: directMessages.id,
                        senderId: directMessages.senderId,
                        sequence: directMessages.sequence,
                        content: directMessages.content,
                        encryptedPayload: directMessages.encryptedPayload,
                        mediaUrl: directMessages.mediaUrl,
                        mediaMimeType: directMessages.mediaMimeType,
                        createdAt: directMessages.createdAt,
                        clientMessageId: directMessages.clientMessageId,
                    })
                    .from(directMessages)
                    .where(
                        thread.lastMessageId
                            ? eq(directMessages.id, thread.lastMessageId)
                            : eq(directMessages.threadId, thread.id)
                    )
                    .orderBy(desc(directMessages.sequence))
                    .limit(1);

                return {
                    status: 200 as const,
                    body: {
                        conversation: {
                            id: thread.id,
                            createdAt: thread.createdAt,
                            lastMessageAt: thread.lastMessageAt,
                            unreadCount: getViewerUnreadCount(thread, userId),
                            ...buildConversationStateFromThread(thread, userId),
                            otherUserId: target.id,
                            otherUsername: target.username,
                            otherProfilePic: target.profilePic,
                            otherBio: target.bio,
                            otherRole: target.role,
                            otherDmPublicKey: extractDmPublicKey(target.dmCrypto ?? null),
                            canMessage,
                            lastMessage: lastMessage
                                ? {
                                    id: lastMessage.id,
                                    senderId: lastMessage.senderId,
                                    content: lastMessage.content,
                                    encryptedPayload: lastMessage.encryptedPayload,
                                    isEncrypted: Boolean(lastMessage.encryptedPayload),
                                    mediaUrl: lastMessage.mediaUrl,
                                    mediaMimeType: lastMessage.mediaMimeType,
                                    createdAt: lastMessage.createdAt,
                                }
                                : null,
                        },
                        thread: {
                            id: thread.id,
                            userAId: thread.userAId,
                            userBId: thread.userBId,
                            userALastReadAt: thread.userALastReadAt,
                            userBLastReadAt: thread.userBLastReadAt,
                            userAUnreadCount: thread.userAUnreadCount,
                            userBUnreadCount: thread.userBUnreadCount,
                            userALastDeliveredSequence: thread.userALastDeliveredSequence,
                            userBLastDeliveredSequence: thread.userBLastDeliveredSequence,
                            userALastSeenSequence: thread.userALastSeenSequence,
                            userBLastSeenSequence: thread.userBLastSeenSequence,
                            nextSequence: thread.nextSequence,
                            lastMessageId: thread.lastMessageId,
                            lastMessageSequence: thread.lastMessageSequence,
                            createdAt: thread.createdAt,
                            lastMessageAt: thread.lastMessageAt,
                            otherUserId: target.id,
                            otherUsername: target.username,
                            otherProfilePic: target.profilePic,
                            otherBio: target.bio,
                            otherRole: target.role,
                            otherIsActive: target.isActive,
                            canMessage,
                            otherDmCrypto: target.dmCrypto ?? null,
                        },
                    },
                };
            });

            if (result.status !== 200 || !body.data.includeMessages) {
                if (result.status !== 200) {
                    return reply.status(result.status).send(result.body);
                }

                const conversationOnly = result.body as {
                    conversation: Record<string, unknown>;
                };

                return reply.status(200).send({
                    conversation: conversationOnly.conversation,
                });
            }

            const bootstrap = result.body as {
                conversation: {
                    id: string;
                    createdAt: string | Date;
                    lastMessageAt: string | Date;
                    unreadCount: number;
                    lastMessageSequence: number;
                    viewerLastDeliveredSequence: number;
                    viewerLastSeenSequence: number;
                    otherLastDeliveredSequence: number;
                    otherLastSeenSequence: number;
                    otherUserId: string;
                    otherUsername: string;
                    otherProfilePic: string | null;
                    otherBio: string | null;
                    otherRole: "admin" | "elite" | "pink" | "user";
                    otherDmPublicKey?: Record<string, unknown> | null;
                    canMessage: boolean;
                    lastMessage: {
                        id: string;
                        senderId: string | null;
                        content: string | null;
                        encryptedPayload?: Record<string, unknown> | null;
                        isEncrypted?: boolean;
                        mediaUrl?: string | null;
                        mediaMimeType?: string | null;
                        createdAt: string | Date | null;
                    } | null;
                    viewerLastReadAt?: string | Date;
                };
                thread: ThreadContextRow;
            };

            const limit = Math.min(100, Math.max(1, body.data.messageLimit ?? 50));
            const thread = bootstrap.thread;
            const deliveredState = await advanceDeliveredSequence({
                threadId: thread.id,
                userId,
                deliveredThroughSequence: getThreadLastMessageSequence(thread),
            });

            applyThreadState(thread, deliveredState.thread);

            if (deliveredState.updated) {
                await publishDeliveredReceipt({
                    thread,
                    actorUserId: userId,
                    actorUsername: username,
                    deliveredThroughSequence: deliveredState.deliveredThroughSequence,
                    deliveredAt: new Date().toISOString(),
                });
            }

            const rows = await db
                .select({
                    id: directMessages.id,
                    conversationId: directMessages.threadId,
                    senderId: directMessages.senderId,
                    senderUsername: users.username,
                    senderProfilePic: users.profilePic,
                    senderRole: users.role,
                    sequence: directMessages.sequence,
                    clientMessageId: directMessages.clientMessageId,
                    content: directMessages.content,
                    encryptedPayload: directMessages.encryptedPayload,
                    mediaUrl: directMessages.mediaUrl,
                    mediaMimeType: directMessages.mediaMimeType,
                    createdAt: directMessages.createdAt,
                })
                .from(directMessages)
                .innerJoin(users, eq(directMessages.senderId, users.id))
                .where(eq(directMessages.threadId, thread.id))
                .orderBy(desc(directMessages.sequence))
                .limit(limit);

            const messages = rows.reverse();
            const firstMessageAt = messages[0]?.createdAt ?? null;
            const lastMessageAt = messages[messages.length - 1]?.createdAt ?? null;
            const firstMessageSequence = messages[0]?.sequence ?? null;
            const lastMessageSequence = messages[messages.length - 1]?.sequence ?? null;

            return reply.status(200).send({
                conversation: {
                    ...bootstrap.conversation,
                    viewerLastDeliveredSequence: getViewerLastDeliveredSequence(thread, userId),
                    viewerLastSeenSequence: getViewerLastSeenSequence(thread, userId),
                    otherLastDeliveredSequence: getOtherLastDeliveredSequence(thread, userId),
                    otherLastSeenSequence: getOtherLastSeenSequence(thread, userId),
                    viewerLastReadAt: getViewerLastReadAt(thread, userId),
                    otherDmPublicKey: extractDmPublicKey(thread.otherDmCrypto),
                },
                messages,
                hasMore: rows.length === limit,
                hasMoreOlder: rows.length === limit,
                hasMoreNewer: false,
                nextBefore: firstMessageAt,
                nextAfter: lastMessageAt,
                nextBeforeSequence: firstMessageSequence,
                nextAfterSequence: lastMessageSequence,
            });
        }
    );

    app.get<{ Params: { id: string }; Querystring: { before?: string; after?: string; beforeSequence?: string; afterSequence?: string; limit?: string } }>(
        "/dm/conversations/:id/messages",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const parsed = ConversationMessagesQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid message query", details: parsed.error.flatten() });
            }

            const thread = await getThreadContext(request.params.id, userId);
            if (!thread) {
                return reply.status(404).send({ error: "Conversation not found" });
            }

            if (!thread.otherIsActive) {
                return reply.status(410).send({ error: "Account suspended" });
            }

            if (await hasMutualBlock(userId, thread.otherUserId)) {
                return reply.status(403).send({ error: "You cannot access this conversation" });
            }

            const limit = Math.min(100, Math.max(1, parseInt(parsed.data.limit ?? "50", 10)));
            const before = parsed.data.before ? new Date(parsed.data.before) : null;
            const after = parsed.data.after ? new Date(parsed.data.after) : null;
            const beforeSequence = parsed.data.beforeSequence ? parseInt(parsed.data.beforeSequence, 10) : null;
            const afterSequence = parsed.data.afterSequence ? parseInt(parsed.data.afterSequence, 10) : null;
            const deliveredState = await advanceDeliveredSequence({
                threadId: thread.id,
                userId,
                deliveredThroughSequence: getThreadLastMessageSequence(thread),
            });

            applyThreadState(thread, deliveredState.thread);

            if (deliveredState.updated) {
                await publishDeliveredReceipt({
                    thread,
                    actorUserId: userId,
                    actorUsername: (request as AuthRequest).username,
                    deliveredThroughSequence: deliveredState.deliveredThroughSequence,
                    deliveredAt: new Date().toISOString(),
                });
            }

            const viewerLastReadAt = getViewerLastReadAt(thread, userId);

            const rows = afterSequence
                ? await db
                    .select({
                        id: directMessages.id,
                        conversationId: directMessages.threadId,
                        senderId: directMessages.senderId,
                        senderUsername: users.username,
                        senderProfilePic: users.profilePic,
                        senderRole: users.role,
                        sequence: directMessages.sequence,
                        clientMessageId: directMessages.clientMessageId,
                        content: directMessages.content,
                        encryptedPayload: directMessages.encryptedPayload,
                        mediaUrl: directMessages.mediaUrl,
                        mediaMimeType: directMessages.mediaMimeType,
                        createdAt: directMessages.createdAt,
                    })
                    .from(directMessages)
                    .innerJoin(users, eq(directMessages.senderId, users.id))
                    .where(and(eq(directMessages.threadId, thread.id), gt(directMessages.sequence, afterSequence)))
                    .orderBy(asc(directMessages.sequence))
                    .limit(limit)
                : after
                ? await db
                    .select({
                        id: directMessages.id,
                        conversationId: directMessages.threadId,
                        senderId: directMessages.senderId,
                        senderUsername: users.username,
                        senderProfilePic: users.profilePic,
                        senderRole: users.role,
                        sequence: directMessages.sequence,
                        clientMessageId: directMessages.clientMessageId,
                        content: directMessages.content,
                        encryptedPayload: directMessages.encryptedPayload,
                        mediaUrl: directMessages.mediaUrl,
                        mediaMimeType: directMessages.mediaMimeType,
                        createdAt: directMessages.createdAt,
                    })
                    .from(directMessages)
                    .innerJoin(users, eq(directMessages.senderId, users.id))
                    .where(and(eq(directMessages.threadId, thread.id), gt(directMessages.createdAt, after)))
                    .orderBy(asc(directMessages.sequence))
                    .limit(limit)
                : beforeSequence
                    ? await db
                        .select({
                            id: directMessages.id,
                            conversationId: directMessages.threadId,
                            senderId: directMessages.senderId,
                            senderUsername: users.username,
                            senderProfilePic: users.profilePic,
                            senderRole: users.role,
                            sequence: directMessages.sequence,
                            clientMessageId: directMessages.clientMessageId,
                            content: directMessages.content,
                            encryptedPayload: directMessages.encryptedPayload,
                            mediaUrl: directMessages.mediaUrl,
                            mediaMimeType: directMessages.mediaMimeType,
                            createdAt: directMessages.createdAt,
                        })
                        .from(directMessages)
                        .innerJoin(users, eq(directMessages.senderId, users.id))
                        .where(and(eq(directMessages.threadId, thread.id), lt(directMessages.sequence, beforeSequence)))
                        .orderBy(desc(directMessages.sequence))
                        .limit(limit)
                : await db
                    .select({
                        id: directMessages.id,
                        conversationId: directMessages.threadId,
                        senderId: directMessages.senderId,
                        senderUsername: users.username,
                        senderProfilePic: users.profilePic,
                        senderRole: users.role,
                        sequence: directMessages.sequence,
                        clientMessageId: directMessages.clientMessageId,
                        content: directMessages.content,
                        encryptedPayload: directMessages.encryptedPayload,
                        mediaUrl: directMessages.mediaUrl,
                        mediaMimeType: directMessages.mediaMimeType,
                        createdAt: directMessages.createdAt,
                    })
                    .from(directMessages)
                    .innerJoin(users, eq(directMessages.senderId, users.id))
                    .where(
                        before
                            ? and(eq(directMessages.threadId, thread.id), lt(directMessages.createdAt, before))
                            : eq(directMessages.threadId, thread.id)
                    )
                    .orderBy(desc(directMessages.sequence))
                    .limit(limit);

            const messages = after || afterSequence ? rows : rows.reverse();
            const firstMessageAt = messages[0]?.createdAt ?? null;
            const lastMessageAt = messages[messages.length - 1]?.createdAt ?? null;
            const firstMessageSequence = messages[0]?.sequence ?? null;
            const lastMessageSequence = messages[messages.length - 1]?.sequence ?? null;

            return reply.send({
                conversation: {
                    id: thread.id,
                    createdAt: thread.createdAt,
                    lastMessageAt: thread.lastMessageAt,
                    unreadCount: getViewerUnreadCount(thread, userId),
                    ...buildConversationStateFromThread(thread, userId),
                    otherUserId: thread.otherUserId,
                    otherUsername: thread.otherUsername,
                    otherProfilePic: thread.otherProfilePic,
                    otherBio: thread.otherBio,
                    otherRole: thread.otherRole,
                    otherDmPublicKey: extractDmPublicKey(thread.otherDmCrypto),
                    canMessage: thread.canMessage,
                    viewerLastReadAt,
                },
                messages,
                hasMore: rows.length === limit,
                hasMoreOlder: !after && !afterSequence && rows.length === limit,
                hasMoreNewer: Boolean(after || afterSequence) && rows.length === limit,
                nextBefore: firstMessageAt,
                nextAfter: lastMessageAt,
                nextBeforeSequence: firstMessageSequence,
                nextAfterSequence: lastMessageSequence,
            });
        }
    );
}
