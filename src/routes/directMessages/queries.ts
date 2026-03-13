import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { blocks, directMessages, directThreads, follows, users } from "../../db/schema";
import { publishDirectMessageEvent } from "../../services/directMessageHub";
import {
    getThreadLastMessageSequence,
    getViewerLastDeliveredSequence,
} from "./helpers";
import type {
    ConversationUnreadCountRow,
    DeliveredSequenceAdvanceResult,
    ExistingMessageRow,
    MessageSequenceRow,
    ThreadContextRow,
    ThreadSequenceRow,
} from "./types";

export async function getUnreadCount(userId: string): Promise<number> {
    const result = await db.execute<ConversationUnreadCountRow>(sql`
        SELECT COALESCE(SUM(
            CASE
                WHEN dt.user_a_id = ${userId} THEN dt.user_a_unread_count
                ELSE dt.user_b_unread_count
            END
        ), 0)::int AS "unreadCount"
        FROM ${directThreads} dt
        INNER JOIN ${users} u
            ON u.id = CASE WHEN dt.user_a_id = ${userId} THEN dt.user_b_id ELSE dt.user_a_id END
        WHERE (dt.user_a_id = ${userId} OR dt.user_b_id = ${userId})
          AND u.is_active = true
          AND NOT EXISTS (
            SELECT 1
            FROM ${blocks} b
            WHERE (
                b.blocker_id = ${userId}
                AND b.blocked_id = CASE WHEN dt.user_a_id = ${userId} THEN dt.user_b_id ELSE dt.user_a_id END
            ) OR (
                b.blocker_id = CASE WHEN dt.user_a_id = ${userId} THEN dt.user_b_id ELSE dt.user_a_id END
                AND b.blocked_id = ${userId}
            )
          )
    `);

    return Number(result.rows[0]?.unreadCount ?? 0);
}

export async function getThreadContext(threadId: string, userId: string): Promise<ThreadContextRow | null> {
    const result = await db.execute<ThreadContextRow>(sql`
        SELECT
            dt.id AS "id",
            dt.user_a_id AS "userAId",
            dt.user_b_id AS "userBId",
            dt.user_a_last_read_at AS "userALastReadAt",
            dt.user_b_last_read_at AS "userBLastReadAt",
            dt.user_a_unread_count AS "userAUnreadCount",
            dt.user_b_unread_count AS "userBUnreadCount",
            dt.user_a_last_delivered_sequence AS "userALastDeliveredSequence",
            dt.user_b_last_delivered_sequence AS "userBLastDeliveredSequence",
            dt.user_a_last_seen_sequence AS "userALastSeenSequence",
            dt.user_b_last_seen_sequence AS "userBLastSeenSequence",
            dt.next_sequence AS "nextSequence",
            dt.last_message_id AS "lastMessageId",
            dt.last_message_sequence AS "lastMessageSequence",
            dt.created_at AS "createdAt",
            dt.last_message_at AS "lastMessageAt",
            u.id AS "otherUserId",
            u.username AS "otherUsername",
            u.profile_pic AS "otherProfilePic",
            u.bio AS "otherBio",
            u.role AS "otherRole",
            u.is_active AS "otherIsActive",
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
            ) AS "canMessage"
        FROM ${directThreads} dt
        INNER JOIN ${users} u
            ON u.id = CASE WHEN dt.user_a_id = ${userId} THEN dt.user_b_id ELSE dt.user_a_id END
        WHERE dt.id = ${threadId}
          AND (dt.user_a_id = ${userId} OR dt.user_b_id = ${userId})
        LIMIT 1
    `);

    return result.rows[0] ?? null;
}

export async function hasMutualBlock(userId: string, otherUserId: string): Promise<boolean> {
    const result = await db.execute<{ blocked: boolean }>(sql`
        SELECT EXISTS (
            SELECT 1
            FROM ${blocks} b
            WHERE (
                b.blocker_id = ${userId}
                AND b.blocked_id = ${otherUserId}
            ) OR (
                b.blocker_id = ${otherUserId}
                AND b.blocked_id = ${userId}
            )
        ) AS blocked
    `);

    return Boolean(result.rows[0]?.blocked);
}

export async function hasMutualFollow(userId: string, otherUserId: string): Promise<boolean> {
    const [viewerFollows, targetFollows] = await Promise.all([
        db
            .select({ followerId: follows.followerId })
            .from(follows)
            .where(and(eq(follows.followerId, userId), eq(follows.followingId, otherUserId)))
            .limit(1),
        db
            .select({ followerId: follows.followerId })
            .from(follows)
            .where(and(eq(follows.followerId, otherUserId), eq(follows.followingId, userId)))
            .limit(1),
    ]);

    return viewerFollows.length > 0 && targetFollows.length > 0;
}

export async function loadThreadForUpdate(tx: any, threadId: string): Promise<ThreadSequenceRow | null> {
    const result = await tx.execute(sql`
        SELECT
            dt.id AS "id",
            dt.user_a_id AS "userAId",
            dt.user_b_id AS "userBId",
            dt.user_a_last_read_at AS "userALastReadAt",
            dt.user_b_last_read_at AS "userBLastReadAt",
            dt.user_a_unread_count AS "userAUnreadCount",
            dt.user_b_unread_count AS "userBUnreadCount",
            dt.user_a_last_delivered_sequence AS "userALastDeliveredSequence",
            dt.user_b_last_delivered_sequence AS "userBLastDeliveredSequence",
            dt.user_a_last_seen_sequence AS "userALastSeenSequence",
            dt.user_b_last_seen_sequence AS "userBLastSeenSequence",
            dt.next_sequence AS "nextSequence",
            dt.last_message_id AS "lastMessageId",
            dt.last_message_sequence AS "lastMessageSequence",
            dt.last_message_at AS "lastMessageAt"
        FROM ${directThreads} dt
        WHERE dt.id = ${threadId}
        FOR UPDATE
    `);

    return (result.rows[0] as ThreadSequenceRow | undefined) ?? null;
}

export function applyThreadState(target: ThreadContextRow | ThreadSequenceRow, source: ThreadSequenceRow): void {
    target.userALastReadAt = source.userALastReadAt;
    target.userBLastReadAt = source.userBLastReadAt;
    target.userAUnreadCount = source.userAUnreadCount;
    target.userBUnreadCount = source.userBUnreadCount;
    target.userALastDeliveredSequence = source.userALastDeliveredSequence;
    target.userBLastDeliveredSequence = source.userBLastDeliveredSequence;
    target.userALastSeenSequence = source.userALastSeenSequence;
    target.userBLastSeenSequence = source.userBLastSeenSequence;
    target.nextSequence = source.nextSequence;
    target.lastMessageId = source.lastMessageId;
    target.lastMessageSequence = source.lastMessageSequence;
    target.lastMessageAt = source.lastMessageAt;
}

export async function findExistingClientMessage(
    tx: any,
    input: { threadId: string; senderId: string; clientMessageId?: string }
): Promise<ExistingMessageRow | null> {
    if (!input.clientMessageId) {
        return null;
    }

    const [existingMessage] = await tx
        .select({
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
        })
        .from(directMessages)
        .where(
            and(
                eq(directMessages.threadId, input.threadId),
                eq(directMessages.senderId, input.senderId),
                eq(directMessages.clientMessageId, input.clientMessageId)
            )
        )
        .limit(1);

    return existingMessage ?? null;
}

export async function resolveMessageSequenceById(client: any, threadId: string, messageId: string): Promise<MessageSequenceRow | null> {
    const [message] = await client
        .select({
            id: directMessages.id,
            createdAt: directMessages.createdAt,
            sequence: directMessages.sequence,
        })
        .from(directMessages)
        .where(and(eq(directMessages.threadId, threadId), eq(directMessages.id, messageId)))
        .limit(1);

    return message ?? null;
}

export async function advanceDeliveredSequence(input: {
    threadId: string;
    userId: string;
    deliveredThroughSequence: number;
}): Promise<DeliveredSequenceAdvanceResult> {
    return db.transaction(async (tx) => {
        const lockedThread = await loadThreadForUpdate(tx, input.threadId);
        if (!lockedThread) {
            throw new Error("Conversation could not be locked");
        }

        const currentDeliveredSequence = getViewerLastDeliveredSequence(lockedThread, input.userId);
        const threadLastMessageSequence = getThreadLastMessageSequence(lockedThread);
        const deliveredThroughSequence = Math.min(
            Math.max(input.deliveredThroughSequence, currentDeliveredSequence),
            threadLastMessageSequence
        );

        if (deliveredThroughSequence <= currentDeliveredSequence) {
            return {
                thread: lockedThread,
                deliveredThroughSequence: currentDeliveredSequence,
                updated: false,
            };
        }

        const updatePayload =
            lockedThread.userAId === input.userId
                ? { userALastDeliveredSequence: deliveredThroughSequence }
                : { userBLastDeliveredSequence: deliveredThroughSequence };

        await tx
            .update(directThreads)
            .set(updatePayload)
            .where(eq(directThreads.id, lockedThread.id));

        if (lockedThread.userAId === input.userId) {
            lockedThread.userALastDeliveredSequence = deliveredThroughSequence;
        } else {
            lockedThread.userBLastDeliveredSequence = deliveredThroughSequence;
        }

        return {
            thread: lockedThread,
            deliveredThroughSequence,
            updated: true,
        };
    });
}

export async function publishDeliveredReceipt(input: {
    thread: ThreadContextRow | ThreadSequenceRow;
    actorUserId: string;
    actorUsername: string;
    deliveredThroughSequence: number;
    deliveredAt: string;
}) {
    if (input.deliveredThroughSequence <= 0) return;

    const otherUserId =
        input.thread.userAId === input.actorUserId
            ? input.thread.userBId
            : input.thread.userAId;

    publishDirectMessageEvent({
        event: "dm:delivered",
        userId: otherUserId,
        conversationId: input.thread.id,
        readerUserId: input.actorUserId,
        senderUsername: input.actorUsername,
        deliveredThroughSequence: input.deliveredThroughSequence,
        readAt: input.deliveredAt,
        at: input.deliveredAt,
    });
}
