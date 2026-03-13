import path from "path";
import { UPLOAD_DIR } from "./schemas";
import type {
    ConversationListRow,
    FriendRow,
    ThreadContextRow,
    ThreadSequenceRow,
} from "./types";

export function normalizeThreadPair(userAId: string, userBId: string): [string, string] {
    return userAId < userBId ? [userAId, userBId] : [userBId, userAId];
}

export function buildConversationSummary(row: ConversationListRow) {
    const otherDmPublicKey = extractDmPublicKey(row.otherDmCrypto);

    return {
        id: row.id,
        createdAt: row.createdAt,
        lastMessageAt: row.lastMessageAt,
        lastMessageSequence: Number(row.lastMessageSequence ?? 0),
        unreadCount: Number(row.unreadCount ?? 0),
        viewerLastDeliveredSequence: Number(row.viewerLastDeliveredSequence ?? 0),
        viewerLastSeenSequence: Number(row.viewerLastSeenSequence ?? 0),
        otherLastDeliveredSequence: Number(row.otherLastDeliveredSequence ?? 0),
        otherLastSeenSequence: Number(row.otherLastSeenSequence ?? 0),
        otherUserId: row.otherUserId,
        otherUsername: row.otherUsername,
        otherProfilePic: row.otherProfilePic,
        otherBio: row.otherBio,
        otherRole: row.otherRole,
        otherDmPublicKey,
        canMessage: row.canMessage,
        lastMessage: row.lastMessageId
            ? {
                id: row.lastMessageId,
                senderId: row.lastMessageSenderId,
                content: row.lastMessageContent,
                encryptedPayload: row.lastMessageEncryptedPayload,
                isEncrypted: Boolean(row.lastMessageEncryptedPayload),
                mediaUrl: row.lastMessageMediaUrl,
                mediaMimeType: row.lastMessageMediaMimeType,
                createdAt: row.lastMessageCreatedAt,
            }
            : null,
    };
}

export function buildDirectMessagePreviewText(input: {
    content?: string | null;
    mediaMimeType?: string | null;
    encryptedPayload?: Record<string, unknown> | null;
}) {
    const trimmedContent = input.content?.trim();
    if (trimmedContent) {
        return trimmedContent;
    }

    if (input.encryptedPayload) {
        return "";
    }

    switch (input.mediaMimeType) {
        case "image/gif":
            return "GIF";
        case "image/webp":
            return "Foto";
        case "video/mp4":
            return "Video";
        default:
            return "";
    }
}

export function buildFriendSummary(row: FriendRow) {
    return {
        userId: row.userId,
        username: row.username,
        profilePic: row.profilePic,
        bio: row.bio,
        role: row.role,
        connectedAt: row.connectedAt,
        conversationId: row.conversationId,
        lastMessageAt: row.lastMessageAt,
        unreadCount: Number(row.unreadCount ?? 0),
    };
}

export function getViewerUnreadCount(
    input: Pick<ThreadContextRow | ThreadSequenceRow, "userAId" | "userAUnreadCount" | "userBUnreadCount">,
    userId: string
) {
    return Number(input.userAId === userId ? input.userAUnreadCount : input.userBUnreadCount);
}

export function getOtherParticipantUnreadCount(
    input: Pick<ThreadContextRow | ThreadSequenceRow, "userAId" | "userAUnreadCount" | "userBUnreadCount">,
    userId: string
) {
    return Number(input.userAId === userId ? input.userBUnreadCount : input.userAUnreadCount);
}

export function getViewerLastReadAt(
    input: Pick<ThreadContextRow | ThreadSequenceRow, "userAId" | "userALastReadAt" | "userBLastReadAt">,
    userId: string
) {
    return input.userAId === userId ? input.userALastReadAt : input.userBLastReadAt;
}

export function getViewerLastDeliveredSequence(
    input: Pick<ThreadContextRow | ThreadSequenceRow, "userAId" | "userALastDeliveredSequence" | "userBLastDeliveredSequence">,
    userId: string
) {
    return Number(input.userAId === userId ? input.userALastDeliveredSequence : input.userBLastDeliveredSequence);
}

export function getOtherLastDeliveredSequence(
    input: Pick<ThreadContextRow | ThreadSequenceRow, "userAId" | "userALastDeliveredSequence" | "userBLastDeliveredSequence">,
    userId: string
) {
    return Number(input.userAId === userId ? input.userBLastDeliveredSequence : input.userALastDeliveredSequence);
}

export function getViewerLastSeenSequence(
    input: Pick<ThreadContextRow | ThreadSequenceRow, "userAId" | "userALastSeenSequence" | "userBLastSeenSequence">,
    userId: string
) {
    return Number(input.userAId === userId ? input.userALastSeenSequence : input.userBLastSeenSequence);
}

export function getOtherLastSeenSequence(
    input: Pick<ThreadContextRow | ThreadSequenceRow, "userAId" | "userALastSeenSequence" | "userBLastSeenSequence">,
    userId: string
) {
    return Number(input.userAId === userId ? input.userBLastSeenSequence : input.userALastSeenSequence);
}

export function getThreadLastMessageSequence(input: Pick<ThreadContextRow | ThreadSequenceRow, "lastMessageSequence">) {
    return Number(input.lastMessageSequence ?? 0);
}

export function resolveUploadedMediaPath(mediaUrl: string) {
    const safeName = path.basename(mediaUrl.replace(/^\/media\//, ""));
    return path.join(UPLOAD_DIR, safeName);
}

export function buildConversationStateFromThread(thread: ThreadContextRow | ThreadSequenceRow, userId: string) {
    return {
        lastMessageSequence: getThreadLastMessageSequence(thread),
        viewerLastDeliveredSequence: getViewerLastDeliveredSequence(thread, userId),
        viewerLastSeenSequence: getViewerLastSeenSequence(thread, userId),
        otherLastDeliveredSequence: getOtherLastDeliveredSequence(thread, userId),
        otherLastSeenSequence: getOtherLastSeenSequence(thread, userId),
    };
}

export function extractDmPublicKey(input: Record<string, unknown> | null | undefined) {
    const publicKey = input?.publicKey;
    return typeof publicKey === "object" && publicKey !== null
        ? (publicKey as Record<string, unknown>)
        : null;
}
