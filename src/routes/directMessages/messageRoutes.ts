import { promises as fsp } from "fs";
import { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { directMessages, directThreads, users } from "../../db/schema";
import type { AuthRequest } from "../../plugins/auth";
import { publishDirectMessageEvent } from "../../services/directMessageHub";
import {
    buildConversationStateFromThread,
    buildDirectMessagePreviewText,
    extractDmPublicKey,
    getOtherParticipantUnreadCount,
    getThreadLastMessageSequence,
    getViewerLastDeliveredSequence,
    getViewerLastSeenSequence,
    getViewerUnreadCount,
    resolveUploadedMediaPath,
} from "./helpers";
import {
    MarkConversationDeliveredSchema,
    MarkConversationReadSchema,
    MAX_DM_VIDEO_SIZE_BYTES,
    SendMessageSchema,
    TypingStateSchema,
} from "./schemas";
import {
    advanceDeliveredSequence,
    applyThreadState,
    findExistingClientMessage,
    getThreadContext,
    getUnreadCount,
    hasMutualBlock,
    hasMutualFollow,
    loadThreadForUpdate,
    publishDeliveredReceipt,
    resolveMessageSequenceById,
} from "./queries";
import type { ConversationUnreadCountRow, ThreadSequenceRow } from "./types";

type ReadResult =
    | {
        ok: false;
        status: number;
        body: { error: string };
    }
    | {
        ok: true;
        thread: ThreadSequenceRow;
        conversationUnreadCount: number;
        readThroughSequence: number;
        readAt: string;
        totalUnreadDelta: number;
        changed: boolean;
    };

export function registerDirectMessageMessageRoutes(app: FastifyInstance) {
    app.post<{
        Params: { id: string };
        Body: {
            content?: string;
            encryptedPayload?: Record<string, unknown>;
            mediaUrl?: string;
            mediaMimeType?: "image/webp" | "image/gif" | "video/mp4";
            clientMessageId?: string;
            originSessionId?: string;
        };
    }>(
        "/dm/conversations/:id/messages",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId, username, userRole } = request as AuthRequest;
            const body = SendMessageSchema.safeParse(request.body);

            if (!body.success) {
                return reply.status(400).send({ error: "Invalid message payload", details: body.error.flatten() });
            }

            const thread = await getThreadContext(request.params.id, userId);
            if (!thread) {
                return reply.status(404).send({ error: "Conversation not found" });
            }

            if (!thread.otherIsActive) {
                return reply.status(410).send({ error: "Account suspended" });
            }

            if (await hasMutualBlock(userId, thread.otherUserId)) {
                return reply.status(403).send({ error: "You cannot message this user" });
            }

            if (!(await hasMutualFollow(userId, thread.otherUserId))) {
                return reply.status(403).send({ error: "Karsilikli takip olmadan mesaj gonderemezsin" });
            }

            if (body.data.mediaUrl?.startsWith("/media/")) {
                try {
                    const mediaStat = await fsp.stat(resolveUploadedMediaPath(body.data.mediaUrl));

                    if (body.data.mediaMimeType === "video/mp4" && mediaStat.size > MAX_DM_VIDEO_SIZE_BYTES) {
                        return reply.status(413).send({
                            error: "Video too large for direct message",
                            detail: "DM icin video boyutu en fazla 8 MB olabilir.",
                        });
                    }
                } catch {
                    return reply.status(400).send({ error: "Invalid media reference" });
                }
            }

            const [senderProfile] = await db
                .select({
                    profilePic: users.profilePic,
                    bio: users.bio,
                })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);

            const now = new Date();
            const messageResult = await db.transaction(async (tx) => {
                const lockedThread = await loadThreadForUpdate(tx, thread.id);
                if (!lockedThread) {
                    throw new Error("Conversation could not be locked");
                }

                const existingMessage = await findExistingClientMessage(tx, {
                    threadId: thread.id,
                    senderId: userId,
                    clientMessageId: body.data.clientMessageId,
                });

                if (existingMessage) {
                    return {
                        message: existingMessage,
                        deduped: true as const,
                        updatedThread: lockedThread,
                    };
                }

                const sequence = Number(lockedThread.nextSequence ?? 1);

                const [message] = await tx
                    .insert(directMessages)
                    .values({
                        threadId: thread.id,
                        senderId: userId,
                        sequence,
                        clientMessageId: body.data.clientMessageId,
                        content: body.data.encryptedPayload ? null : (body.data.content ?? null),
                        encryptedPayload: body.data.encryptedPayload ?? null,
                        mediaUrl: body.data.mediaUrl ?? null,
                        mediaMimeType: body.data.mediaMimeType ?? null,
                        createdAt: now,
                    })
                    .returning({
                        id: directMessages.id,
                        conversationId: directMessages.threadId,
                        senderId: directMessages.senderId,
                        sequence: directMessages.sequence,
                        clientMessageId: directMessages.clientMessageId,
                        content: directMessages.content,
                        encryptedPayload: directMessages.encryptedPayload,
                        mediaUrl: directMessages.mediaUrl,
                        mediaMimeType: directMessages.mediaMimeType,
                        createdAt: directMessages.createdAt,
                    });

                if (!message) {
                    throw new Error("Message could not be created");
                }

                const threadUpdate =
                    lockedThread.userAId === userId
                        ? {
                            userALastReadAt: now,
                            userAUnreadCount: 0,
                            userALastDeliveredSequence: sequence,
                            userALastSeenSequence: sequence,
                            userBUnreadCount: sql`${directThreads.userBUnreadCount} + 1`,
                            nextSequence: sequence + 1,
                            lastMessageAt: now,
                            lastMessageId: message.id,
                            lastMessageSequence: sequence,
                        }
                        : {
                            userBLastReadAt: now,
                            userBUnreadCount: 0,
                            userBLastDeliveredSequence: sequence,
                            userBLastSeenSequence: sequence,
                            userAUnreadCount: sql`${directThreads.userAUnreadCount} + 1`,
                            nextSequence: sequence + 1,
                            lastMessageAt: now,
                            lastMessageId: message.id,
                            lastMessageSequence: sequence,
                        };

                const [updatedThread] = await tx
                    .update(directThreads)
                    .set(threadUpdate)
                    .where(eq(directThreads.id, thread.id))
                    .returning({
                        id: directThreads.id,
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
                        lastMessageId: directThreads.lastMessageId,
                        lastMessageSequence: directThreads.lastMessageSequence,
                        lastMessageAt: directThreads.lastMessageAt,
                    });

                return {
                    message,
                    deduped: false as const,
                    updatedThread,
                };
            });

            const message = messageResult.message;
            const messageCreatedAt = new Date(message.createdAt).toISOString();
            const previewText = buildDirectMessagePreviewText({
                content: message.content,
                mediaMimeType: message.mediaMimeType,
                encryptedPayload: message.encryptedPayload,
            });
            const realtimeMessage = {
                id: message.id,
                conversationId: thread.id,
                senderId: userId,
                senderUsername: username,
                senderProfilePic: senderProfile?.profilePic ?? null,
                senderRole: userRole,
                sequence: Number(message.sequence),
                clientMessageId: message.clientMessageId ?? null,
                content: message.content,
                encryptedPayload: message.encryptedPayload ?? null,
                isEncrypted: Boolean(message.encryptedPayload),
                mediaUrl: message.mediaUrl ?? null,
                mediaMimeType: message.mediaMimeType ?? null,
                createdAt: messageCreatedAt,
            };

            if (messageResult.deduped) {
                const dedupedConversationState = buildConversationStateFromThread(messageResult.updatedThread, userId);
                const dedupedConversationUnreadCount = getViewerUnreadCount(messageResult.updatedThread, userId);

                return reply.status(200).send({
                    message: {
                        ...message,
                        senderUsername: username,
                        senderProfilePic: senderProfile?.profilePic ?? null,
                        senderRole: userRole,
                    },
                    conversation: {
                        id: thread.id,
                        createdAt: thread.createdAt,
                        lastMessageAt: messageCreatedAt,
                        unreadCount: dedupedConversationUnreadCount,
                        ...dedupedConversationState,
                        canMessage: thread.canMessage,
                        otherUserId: thread.otherUserId,
                        otherUsername: thread.otherUsername,
                        otherProfilePic: thread.otherProfilePic,
                        otherBio: thread.otherBio,
                        otherRole: thread.otherRole,
                        otherDmPublicKey: extractDmPublicKey(thread.otherDmCrypto),
                        lastMessage: {
                            id: message.id,
                            senderId: userId,
                            content: message.content,
                            encryptedPayload: message.encryptedPayload ?? null,
                            isEncrypted: Boolean(message.encryptedPayload),
                            mediaUrl: message.mediaUrl ?? null,
                            mediaMimeType: message.mediaMimeType ?? null,
                            createdAt: messageCreatedAt,
                        },
                    },
                    deduped: true,
                });
            }

            const updatedThread = messageResult.updatedThread;
            if (!updatedThread) {
                return reply.status(500).send({ error: "Conversation state could not be updated" });
            }

            const senderConversationUnreadCount = getViewerUnreadCount(updatedThread, userId);
            const recipientConversationUnreadCount = getOtherParticipantUnreadCount(updatedThread, userId);
            const updatedConversationState = buildConversationStateFromThread(updatedThread, userId);

            publishDirectMessageEvent({
                event: "dm:new",
                userId: thread.otherUserId,
                conversationId: thread.id,
                messageId: message.id,
                senderId: userId,
                messageSequence: Number(message.sequence),
                totalUnreadDelta: 1,
                conversationUnreadCount: recipientConversationUnreadCount,
                senderUsername: username,
                counterpartyUsername: username,
                previewText,
                clientMessageId: message.clientMessageId ?? undefined,
                originSessionId: body.data.originSessionId,
                message: realtimeMessage,
                conversation: {
                    id: thread.id,
                    createdAt: new Date(thread.createdAt).toISOString(),
                    lastMessageAt: messageCreatedAt,
                    unreadCount: recipientConversationUnreadCount,
                    lastMessageSequence: Number(message.sequence),
                    viewerLastDeliveredSequence: updatedConversationState.otherLastDeliveredSequence,
                    viewerLastSeenSequence: updatedConversationState.otherLastSeenSequence,
                    otherLastDeliveredSequence: updatedConversationState.viewerLastDeliveredSequence,
                    otherLastSeenSequence: updatedConversationState.viewerLastSeenSequence,
                    canMessage: true,
                    otherUserId: userId,
                    otherUsername: username,
                    otherProfilePic: senderProfile?.profilePic ?? null,
                    otherBio: senderProfile?.bio ?? null,
                    otherRole: userRole,
                    lastMessage: {
                        id: message.id,
                        senderId: userId,
                        content: message.content,
                        encryptedPayload: message.encryptedPayload ?? null,
                        isEncrypted: Boolean(message.encryptedPayload),
                        mediaUrl: message.mediaUrl ?? null,
                        mediaMimeType: message.mediaMimeType ?? null,
                        createdAt: messageCreatedAt,
                    },
                },
                shouldPush: true,
                at: messageCreatedAt,
            });

            publishDirectMessageEvent({
                event: "dm:new",
                userId,
                conversationId: thread.id,
                messageId: message.id,
                senderId: userId,
                messageSequence: Number(message.sequence),
                conversationUnreadCount: senderConversationUnreadCount,
                senderUsername: username,
                counterpartyUsername: thread.otherUsername,
                previewText,
                clientMessageId: message.clientMessageId ?? undefined,
                originSessionId: body.data.originSessionId,
                message: realtimeMessage,
                conversation: {
                    id: thread.id,
                    createdAt: new Date(thread.createdAt).toISOString(),
                    lastMessageAt: messageCreatedAt,
                    unreadCount: senderConversationUnreadCount,
                    ...updatedConversationState,
                    canMessage: thread.canMessage,
                    otherUserId: thread.otherUserId,
                    otherUsername: thread.otherUsername,
                    otherProfilePic: thread.otherProfilePic,
                    otherBio: thread.otherBio,
                    otherRole: thread.otherRole,
                    otherDmPublicKey: extractDmPublicKey(thread.otherDmCrypto),
                    lastMessage: {
                        id: message.id,
                        senderId: userId,
                        content: message.content,
                        encryptedPayload: message.encryptedPayload ?? null,
                        isEncrypted: Boolean(message.encryptedPayload),
                        mediaUrl: message.mediaUrl ?? null,
                        mediaMimeType: message.mediaMimeType ?? null,
                        createdAt: messageCreatedAt,
                    },
                },
                shouldPush: false,
                at: messageCreatedAt,
            });

            return reply.status(201).send({
                message: {
                    ...message,
                    senderUsername: username,
                    senderProfilePic: senderProfile?.profilePic ?? null,
                    senderRole: userRole,
                },
                conversation: {
                    id: thread.id,
                    createdAt: thread.createdAt,
                    lastMessageAt: messageCreatedAt,
                    unreadCount: senderConversationUnreadCount,
                    ...updatedConversationState,
                    canMessage: thread.canMessage,
                    otherUserId: thread.otherUserId,
                    otherUsername: thread.otherUsername,
                    otherProfilePic: thread.otherProfilePic,
                    otherBio: thread.otherBio,
                    otherRole: thread.otherRole,
                    otherDmPublicKey: extractDmPublicKey(thread.otherDmCrypto),
                    lastMessage: {
                        id: message.id,
                        senderId: userId,
                        content: message.content,
                        encryptedPayload: message.encryptedPayload ?? null,
                        isEncrypted: Boolean(message.encryptedPayload),
                        mediaUrl: message.mediaUrl ?? null,
                        mediaMimeType: message.mediaMimeType ?? null,
                        createdAt: messageCreatedAt,
                    },
                },
                deduped: false,
            });
        }
    );

    app.patch<{ Params: { id: string }; Body: { deliveredThroughMessageId?: string; deliveredThroughSequence?: number } }>(
        "/dm/conversations/:id/delivered",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId, username } = request as AuthRequest;
            const body = MarkConversationDeliveredSchema.safeParse(request.body ?? {});

            if (!body.success) {
                return reply.status(400).send({ error: "Invalid delivered payload", details: body.error.flatten() });
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

            let deliveredThroughSequence = body.data.deliveredThroughSequence ?? getThreadLastMessageSequence(thread);

            if (body.data.deliveredThroughMessageId) {
                const targetMessage = await resolveMessageSequenceById(db, thread.id, body.data.deliveredThroughMessageId);
                if (!targetMessage) {
                    return reply.status(404).send({ error: "Message not found in conversation" });
                }
                deliveredThroughSequence = Number(targetMessage.sequence);
            }

            const deliveredResult = await advanceDeliveredSequence({
                threadId: thread.id,
                userId,
                deliveredThroughSequence,
            });

            applyThreadState(thread, deliveredResult.thread);

            if (!deliveredResult.updated) {
                return reply.send({
                    success: true,
                    deliveredThroughSequence: deliveredResult.deliveredThroughSequence,
                    ...buildConversationStateFromThread(thread, userId),
                });
            }

            const deliveredAt = new Date().toISOString();
            await publishDeliveredReceipt({
                thread,
                actorUserId: userId,
                actorUsername: username,
                deliveredThroughSequence: deliveredResult.deliveredThroughSequence,
                deliveredAt,
            });

            return reply.send({
                success: true,
                deliveredThroughSequence: deliveredResult.deliveredThroughSequence,
                deliveredAt,
                ...buildConversationStateFromThread(thread, userId),
            });
        }
    );

    app.patch<{ Params: { id: string }; Body: { readThroughMessageId?: string; readThroughSequence?: number } }>(
        "/dm/conversations/:id/read",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            const body = MarkConversationReadSchema.safeParse(request.body ?? {});

            if (!body.success) {
                return reply.status(400).send({ error: "Invalid read payload", details: body.error.flatten() });
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

            const now = new Date();
            const readResult: ReadResult = await db.transaction(async (tx) => {
                const lockedThread = await loadThreadForUpdate(tx, thread.id);
                if (!lockedThread) {
                    throw new Error("Conversation could not be locked");
                }

                const currentLastReadAt = new Date(
                    lockedThread.userAId === userId ? lockedThread.userALastReadAt : lockedThread.userBLastReadAt
                );
                const currentConversationUnreadCount = getViewerUnreadCount(lockedThread, userId);
                const currentSeenSequence = getViewerLastSeenSequence(lockedThread, userId);
                const currentDeliveredSequence = getViewerLastDeliveredSequence(lockedThread, userId);
                const threadLastMessageSequence = getThreadLastMessageSequence(lockedThread);

                let readAt = currentLastReadAt;
                let readThroughSequence = body.data.readThroughSequence ?? threadLastMessageSequence;

                if (body.data.readThroughMessageId) {
                    const targetMessage = await resolveMessageSequenceById(tx, lockedThread.id, body.data.readThroughMessageId);
                    if (!targetMessage) {
                        return {
                            ok: false,
                            status: 404,
                            body: { error: "Message not found in conversation" },
                        };
                    }

                    readThroughSequence = Number(targetMessage.sequence);
                }

                readThroughSequence = Math.min(Math.max(readThroughSequence, currentSeenSequence), threadLastMessageSequence);

                if (readThroughSequence > currentSeenSequence) {
                    readAt = now;
                }

                const nextDeliveredSequence = Math.max(currentDeliveredSequence, readThroughSequence);

                if (readThroughSequence <= currentSeenSequence && nextDeliveredSequence === currentDeliveredSequence) {
                    return {
                        ok: true,
                        thread: lockedThread,
                        conversationUnreadCount: currentConversationUnreadCount,
                        readThroughSequence: currentSeenSequence,
                        readAt: currentLastReadAt.toISOString(),
                        totalUnreadDelta: 0,
                        changed: false,
                    };
                }

                const conversationUnreadCount =
                    readThroughSequence >= threadLastMessageSequence
                        ? 0
                        : Number(
                            (
                                await tx.execute<ConversationUnreadCountRow>(sql`
                                    SELECT COUNT(*)::int AS "unreadCount"
                                    FROM ${directMessages}
                                    WHERE thread_id = ${lockedThread.id}
                                      AND sender_id <> ${userId}
                                      AND sequence > ${readThroughSequence}
                                `)
                            ).rows[0]?.unreadCount ?? 0
                        );

                const updatePayload =
                    lockedThread.userAId === userId
                        ? {
                            userALastReadAt: readAt,
                            userAUnreadCount: conversationUnreadCount,
                            userALastDeliveredSequence: nextDeliveredSequence,
                            userALastSeenSequence: readThroughSequence,
                        }
                        : {
                            userBLastReadAt: readAt,
                            userBUnreadCount: conversationUnreadCount,
                            userBLastDeliveredSequence: nextDeliveredSequence,
                            userBLastSeenSequence: readThroughSequence,
                        };

                await tx
                    .update(directThreads)
                    .set(updatePayload)
                    .where(eq(directThreads.id, lockedThread.id));

                if (lockedThread.userAId === userId) {
                    lockedThread.userALastReadAt = readAt.toISOString();
                    lockedThread.userAUnreadCount = conversationUnreadCount;
                    lockedThread.userALastDeliveredSequence = nextDeliveredSequence;
                    lockedThread.userALastSeenSequence = readThroughSequence;
                } else {
                    lockedThread.userBLastReadAt = readAt.toISOString();
                    lockedThread.userBUnreadCount = conversationUnreadCount;
                    lockedThread.userBLastDeliveredSequence = nextDeliveredSequence;
                    lockedThread.userBLastSeenSequence = readThroughSequence;
                }

                return {
                    ok: true,
                    thread: lockedThread,
                    conversationUnreadCount,
                    readThroughSequence,
                    readAt: readAt.toISOString(),
                    totalUnreadDelta: conversationUnreadCount - currentConversationUnreadCount,
                    changed: true,
                };
            });

            if (!readResult.ok) {
                return reply.status(readResult.status).send(readResult.body);
            }

            applyThreadState(thread, readResult.thread);

            const totalUnreadCount = await getUnreadCount(userId);
            const eventAt = now.toISOString();

            if (readResult.changed) {
                publishDirectMessageEvent({
                    event: "dm:read",
                    userId,
                    conversationId: thread.id,
                    unreadCount: totalUnreadCount,
                    totalUnreadCount,
                    totalUnreadDelta: readResult.totalUnreadDelta,
                    conversationUnreadCount: readResult.conversationUnreadCount,
                    readerUserId: userId,
                    deliveredThroughSequence: getViewerLastDeliveredSequence(thread, userId),
                    seenThroughSequence: getViewerLastSeenSequence(thread, userId),
                    readAt: readResult.readAt,
                    readThroughMessageId: body.data.readThroughMessageId,
                    readThroughSequence: readResult.readThroughSequence,
                    at: eventAt,
                });

                publishDirectMessageEvent({
                    event: "dm:seen",
                    userId: thread.otherUserId,
                    conversationId: thread.id,
                    readerUserId: userId,
                    deliveredThroughSequence: getViewerLastDeliveredSequence(thread, userId),
                    seenThroughSequence: getViewerLastSeenSequence(thread, userId),
                    readAt: readResult.readAt,
                    readThroughMessageId: body.data.readThroughMessageId,
                    readThroughSequence: readResult.readThroughSequence,
                    at: eventAt,
                });
            }

            return reply.send({
                success: true,
                unreadCount: totalUnreadCount,
                totalUnreadCount,
                conversationUnreadCount: readResult.conversationUnreadCount,
                readThroughSequence: readResult.readThroughSequence,
                readAt: readResult.readAt,
                totalUnreadDelta: readResult.totalUnreadDelta,
                ...buildConversationStateFromThread(thread, userId),
            });
        }
    );

    app.post<{ Params: { id: string }; Body: { isTyping: boolean } }>(
        "/dm/conversations/:id/typing",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId, username } = request as AuthRequest;
            const body = TypingStateSchema.safeParse(request.body);

            if (!body.success) {
                return reply.status(400).send({ error: "Invalid typing payload", details: body.error.flatten() });
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

            if (!(await hasMutualFollow(userId, thread.otherUserId))) {
                return reply.status(403).send({ error: "Karsilikli takip olmadan typing gonderemezsin" });
            }

            publishDirectMessageEvent({
                event: "dm:typing",
                userId: thread.otherUserId,
                conversationId: thread.id,
                senderId: userId,
                senderUsername: username,
                typing: body.data.isTyping,
                at: new Date().toISOString(),
            });

            return reply.send({ success: true });
        }
    );
}
