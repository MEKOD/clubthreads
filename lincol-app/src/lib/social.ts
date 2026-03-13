import type { PollData } from '../components/feed/PollView';

export interface LinkPreview {
    url: string;
    title: string;
    description?: string | null;
    imageUrl?: string | null;
    siteName?: string | null;
}

export interface ParentPreview {
    id: string;
    content: string | null;
    mediaUrl: string | null;
    mediaMimeType?: string | null;
    authorUsername: string;
    authorProfilePic?: string | null;
    linkPreview?: LinkPreview | null;
    parentAuthorUsername?: string | null;
}

export interface TimelinePost {
    id: string;
    content: string | null;
    poll?: PollData;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    type?: 'post' | 'rt' | 'quote';
    parentId?: string | null;
    favCount: number;
    trashCount: number;
    replyCount: number;
    rtCount?: number;
    viewCount?: number;
    createdAt: string;
    authorUsername: string;
    authorProfilePic: string | null;
    authorRole?: 'admin' | 'elite' | 'pink' | 'user';
    communityId?: string | null;
    communitySlug?: string | null;
    communityName?: string | null;
    hasFav?: boolean;
    hasTrash?: boolean;
    linkPreview?: LinkPreview | null;
    parentPreview?: ParentPreview | null;
}

export interface CommunitySummary {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    isPrivate: boolean;
    memberCount: number;
    avatarUrl: string | null;
    bannerUrl: string | null;
    creatorId?: string;
    createdAt: string;
    isMember: boolean;
    viewerRole: 'owner' | 'moderator' | 'member' | null;
    hasInvite?: boolean;
    hasRequestedJoin?: boolean;
}

export interface CommunityRule {
    id: string;
    title: string;
    description: string;
    sortOrder: number;
    createdAt: string;
    createdBy: string;
}

export interface CommunityMember {
    userId: string;
    username: string;
    profilePic: string | null;
    bio: string | null;
    role: 'owner' | 'moderator' | 'member';
    joinedAt: string;
}

export interface CommunityJoinRequest {
    userId: string;
    username: string;
    profilePic: string | null;
    bio: string | null;
    requestedAt: string;
}

export interface CommunityInvite {
    communityId: string;
    slug: string;
    name: string;
    description: string | null;
    isPrivate: boolean;
    memberCount: number;
    avatarUrl: string | null;
    bannerUrl: string | null;
    creatorId?: string;
    createdAt: string;
    invitedAt: string;
    inviterUsername: string;
}

export interface BlockedUser {
    id: string;
    username: string;
    profilePic: string | null;
    bio: string | null;
    createdAt: string;
}

export interface DirectConversationSummary {
    id: string;
    createdAt: string;
    lastMessageAt: string;
    lastMessageSequence?: number;
    unreadCount: number;
    viewerLastDeliveredSequence?: number;
    viewerLastSeenSequence?: number;
    otherLastDeliveredSequence?: number;
    otherLastSeenSequence?: number;
    viewerLastReadAt?: string;
    canMessage: boolean;
    otherUserId: string;
    otherUsername: string;
    otherProfilePic: string | null;
    otherBio: string | null;
    otherRole: 'admin' | 'elite' | 'pink' | 'user';
    otherDmPublicKey?: JsonWebKey | null;
    lastMessage: {
        id: string;
        senderId: string | null;
        content: string | null;
        encryptedPayload?: Record<string, unknown> | null;
        isEncrypted?: boolean;
        mediaUrl?: string | null;
        mediaMimeType?: string | null;
        createdAt: string | null;
    } | null;
}

export interface DirectMessage {
    id: string;
    conversationId: string;
    senderId: string;
    senderUsername: string;
    senderProfilePic: string | null;
    senderRole: 'admin' | 'elite' | 'pink' | 'user';
    sequence?: number;
    clientMessageId?: string | null;
    content: string | null;
    encryptedPayload?: Record<string, unknown> | null;
    isEncrypted?: boolean;
    mediaUrl?: string | null;
    mediaMimeType?: string | null;
    createdAt: string;
}

export interface DirectFriend {
    userId: string;
    username: string;
    profilePic: string | null;
    bio: string | null;
    role: 'admin' | 'elite' | 'pink' | 'user';
    connectedAt: string;
    conversationId: string | null;
    lastMessageAt: string | null;
    unreadCount: number;
}

export interface CommunityDetail extends CommunitySummary {
    permissions?: {
        canView: boolean;
        canPost: boolean;
        canModerate: boolean;
        canManage: boolean;
        canDelete: boolean;
    };
    hasInvite?: boolean;
    hasRequestedJoin?: boolean;
}

export interface TrendingKeyword {
    keyword: string;
    count: number;
}

export function formatTrendingKeyword(keyword: string) {
    return keyword.startsWith('#') ? keyword : keyword;
}
