export interface ConversationListRow extends Record<string, unknown> {
    id: string;
    createdAt: string | Date;
    lastMessageAt: string | Date;
    lastMessageSequence: number | string;
    otherUserId: string;
    otherUsername: string;
    otherProfilePic: string | null;
    otherBio: string | null;
    otherRole: "admin" | "elite" | "pink" | "user";
    lastMessageId: string | null;
    lastMessageSenderId: string | null;
    lastMessageContent: string | null;
    lastMessageEncryptedPayload: Record<string, unknown> | null;
    lastMessageMediaUrl: string | null;
    lastMessageMediaMimeType: string | null;
    lastMessageCreatedAt: string | Date | null;
    viewerLastDeliveredSequence: number | string;
    viewerLastSeenSequence: number | string;
    otherLastDeliveredSequence: number | string;
    otherLastSeenSequence: number | string;
    unreadCount: number | string;
    canMessage: boolean;
    otherDmCrypto: Record<string, unknown> | null;
}

export interface ConversationUnreadCountRow extends Record<string, unknown> {
    unreadCount: number | string;
}

export interface FriendRow extends Record<string, unknown> {
    userId: string;
    username: string;
    profilePic: string | null;
    bio: string | null;
    role: "admin" | "elite" | "pink" | "user";
    connectedAt: string | Date;
    conversationId: string | null;
    lastMessageAt: string | Date | null;
    unreadCount: number | string;
}

export interface ThreadContextRow extends Record<string, unknown> {
    id: string;
    userAId: string;
    userBId: string;
    userALastReadAt: string | Date;
    userBLastReadAt: string | Date;
    userAUnreadCount: number | string;
    userBUnreadCount: number | string;
    userALastDeliveredSequence: number | string;
    userBLastDeliveredSequence: number | string;
    userALastSeenSequence: number | string;
    userBLastSeenSequence: number | string;
    nextSequence: number | string;
    lastMessageId: string | null;
    lastMessageSequence: number | string;
    createdAt: string | Date;
    lastMessageAt: string | Date;
    otherUserId: string;
    otherUsername: string;
    otherProfilePic: string | null;
    otherBio: string | null;
    otherRole: "admin" | "elite" | "pink" | "user";
    otherIsActive: boolean;
    canMessage: boolean;
    otherDmCrypto: Record<string, unknown> | null;
}

export interface ThreadSequenceRow extends Record<string, unknown> {
    id: string;
    userAId: string;
    userBId: string;
    userALastReadAt: string | Date;
    userBLastReadAt: string | Date;
    userAUnreadCount: number | string;
    userBUnreadCount: number | string;
    userALastDeliveredSequence: number | string;
    userBLastDeliveredSequence: number | string;
    userALastSeenSequence: number | string;
    userBLastSeenSequence: number | string;
    nextSequence: number | string;
    lastMessageId: string | null;
    lastMessageSequence: number | string;
    lastMessageAt: string | Date;
}

export interface MessageSequenceRow extends Record<string, unknown> {
    id: string;
    createdAt: string | Date;
    sequence: number | string;
}

export interface DeliveredSequenceAdvanceResult {
    thread: ThreadSequenceRow;
    deliveredThroughSequence: number;
    updated: boolean;
}

export interface ExistingMessageRow extends Record<string, unknown> {
    id: string;
    conversationId: string;
    senderId: string;
    sequence: number | string;
    clientMessageId: string | null;
    content: string | null;
    encryptedPayload: Record<string, unknown> | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    createdAt: string | Date;
}
