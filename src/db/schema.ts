import {
    pgTable,
    uuid,
    varchar,
    text,
    timestamp,
    pgEnum,
    uniqueIndex,
    index,
    primaryKey,
    integer,
    boolean,
    jsonb,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ─── ENUMs ──────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["admin", "elite", "pink", "user"]);
export const postTypeEnum = pgEnum("post_type", ["post", "rt", "quote"]);
export const interactionTypeEnum = pgEnum("interaction_type", ["FAV", "TRASH"]);
export const notificationTypeEnum = pgEnum("notification_type", ["follow", "fav", "reply", "quote", "rt", "mention", "community_invite", "community_join_request"]);
export const notificationActionStatusEnum = pgEnum("notification_action_status", ["accepted", "rejected"]);

// ─── USERS ──────────────────────────────────────────────────────────────────

export const users = pgTable(
    "users",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        username: varchar("username", { length: 32 }).notNull(),
        passwordHash: text("password_hash").notNull(),
        dmCrypto: jsonb("dm_crypto").$type<Record<string, unknown> | null>(),
        profilePic: text("profile_pic"),
        coverPic: text("cover_pic"),
        bio: text("bio"),
        rejectCommunityInvites: boolean("reject_community_invites").notNull().default(false),
        role: roleEnum("role").notNull().default("user"),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        usernameUniqueIdx: uniqueIndex("users_username_unique_idx").on(
            table.username
        ),
    })
);

// ─── POSTS ──────────────────────────────────────────────────────────────────

export const posts = pgTable(
    "posts",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        content: text("content"),
        mediaUrl: text("media_url"),
        mediaMimeType: varchar("media_mime_type", { length: 64 }),
        linkPreviewUrl: text("link_preview_url"),
        linkPreviewTitle: text("link_preview_title"),
        linkPreviewDescription: text("link_preview_description"),
        linkPreviewImageUrl: text("link_preview_image_url"),
        linkPreviewSiteName: varchar("link_preview_site_name", { length: 128 }),
        // Self-referencing: retweets, quotes, and replies all point to a parent
        parentId: uuid("parent_id").references((): any => posts.id, {
            onDelete: "set null",
        }),
        type: postTypeEnum("type").notNull().default("post"),
        // Denormalised counters for hot queries — updated via triggers or service layer
        favCount: integer("fav_count").notNull().default(0),
        trashCount: integer("trash_count").notNull().default(0),
        replyCount: integer("reply_count").notNull().default(0),
        rtCount: integer("rt_count").notNull().default(0),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        userIdIdx: index("posts_user_id_idx").on(table.userId),
        userCreatedAtIdx: index("posts_user_created_at_idx").on(table.userId, table.createdAt),
        parentIdIdx: index("posts_parent_id_idx").on(table.parentId),
        parentCreatedAtIdx: index("posts_parent_created_at_idx").on(table.parentId, table.createdAt),
        createdAtIdx: index("posts_created_at_idx").on(table.createdAt),
        createdAtIdIdx: index("posts_created_at_id_idx").on(table.createdAt, table.id),
        trashCreatedAtIdx: index("posts_trash_created_at_idx").on(table.trashCount, table.createdAt),
        // Composite index for the decay algorithm query
        decayIdx: index("posts_decay_idx").on(
            table.favCount,
            table.trashCount,
            table.createdAt
        ),
    })
);

// ─── INTERACTIONS ────────────────────────────────────────────────────────────

export const interactions = pgTable(
    "interactions",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        postId: uuid("post_id")
            .notNull()
            .references(() => posts.id, { onDelete: "cascade" }),
        type: interactionTypeEnum("type").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        // A user can only FAV or TRASH a post once (one interaction per type)
        userPostTypeUnique: uniqueIndex("interactions_user_post_type_unique").on(
            table.userId,
            table.postId,
            table.type
        ),
        postIdIdx: index("interactions_post_id_idx").on(table.postId),
        userIdIdx: index("interactions_user_id_idx").on(table.userId),
    })
);

// ─── FOLLOWS ─────────────────────────────────────────────────────────────────

export const follows = pgTable(
    "follows",
    {
        followerId: uuid("follower_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        followingId: uuid("following_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.followerId, table.followingId] }),
        followerIdx: index("follows_follower_id_idx").on(table.followerId),
        followingIdx: index("follows_following_id_idx").on(table.followingId),
    })
);

// ─── BLOCKS ──────────────────────────────────────────────────────────────────

export const blocks = pgTable(
    "blocks",
    {
        blockerId: uuid("blocker_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        blockedId: uuid("blocked_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.blockerId, table.blockedId] }),
        blockerIdx: index("blocks_blocker_id_idx").on(table.blockerId),
        blockedIdx: index("blocks_blocked_id_idx").on(table.blockedId),
    })
);

// ─── COMMUNITIES ─────────────────────────────────────────────────────────────

export const communities = pgTable(
    "communities",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        name: varchar("name", { length: 64 }).notNull(),
        slug: varchar("slug", { length: 64 }).notNull(),
        description: text("description"),
        creatorId: uuid("creator_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        avatarUrl: text("avatar_url"),
        bannerUrl: text("banner_url"),
        isPrivate: boolean("is_private").notNull().default(false),
        memberCount: integer("member_count").notNull().default(0),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        slugUniqueIdx: uniqueIndex("communities_slug_unique_idx").on(table.slug),
        creatorIdIdx: index("communities_creator_id_idx").on(table.creatorId),
    })
);

export const communityRules = pgTable(
    "community_rules",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        communityId: uuid("community_id")
            .notNull()
            .references(() => communities.id, { onDelete: "cascade" }),
        title: varchar("title", { length: 120 }).notNull(),
        description: text("description").notNull(),
        sortOrder: integer("sort_order").notNull().default(0),
        createdBy: uuid("created_by")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        communitySortIdx: index("community_rules_community_sort_idx").on(table.communityId, table.sortOrder),
    })
);

// ─── COMMUNITY MEMBERS ───────────────────────────────────────────────────────

export const communityMemberRoleEnum = pgEnum("community_member_role", [
    "owner",
    "moderator",
    "member",
]);

export const communityMembers = pgTable(
    "community_members",
    {
        communityId: uuid("community_id")
            .notNull()
            .references(() => communities.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        role: communityMemberRoleEnum("role").notNull().default("member"),
        joinedAt: timestamp("joined_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.communityId, table.userId] }),
        userIdIdx: index("community_members_user_id_idx").on(table.userId),
    })
);

export const communityJoinRequests = pgTable(
    "community_join_requests",
    {
        communityId: uuid("community_id")
            .notNull()
            .references(() => communities.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.communityId, table.userId] }),
        userIdIdx: index("community_join_requests_user_id_idx").on(table.userId),
    })
);

export const communityInvites = pgTable(
    "community_invites",
    {
        communityId: uuid("community_id")
            .notNull()
            .references(() => communities.id, { onDelete: "cascade" }),
        invitedUserId: uuid("invited_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        inviterUserId: uuid("inviter_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.communityId, table.invitedUserId] }),
        invitedUserIdIdx: index("community_invites_invited_user_id_idx").on(table.invitedUserId),
    })
);

// ─── POST COMMUNITIES ────────────────────────────────────────────────────────

export const postCommunities = pgTable(
    "post_communities",
    {
        postId: uuid("post_id")
            .notNull()
            .references(() => posts.id, { onDelete: "cascade" }),
        communityId: uuid("community_id")
            .notNull()
            .references(() => communities.id, { onDelete: "cascade" }),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.postId, table.communityId] }),
        communityPostIdx: index("post_communities_community_id_post_id_idx").on(table.communityId, table.postId),
    })
);

// ─── NOTIFICATIONS ─────────────────────────────────────────────────────────────

export const notifications = pgTable(
    "notifications",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }), // The receiver
        actorId: uuid("actor_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }), // The doer
        type: notificationTypeEnum("type").notNull(),
        postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }), // Optional context
        communityId: uuid("community_id").references(() => communities.id, { onDelete: "cascade" }),
        actionStatus: notificationActionStatusEnum("action_status"),
        resolvedAt: timestamp("resolved_at", { withTimezone: true }),
        isRead: boolean("is_read").notNull().default(false),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        userIdIdx: index("notifications_user_id_idx").on(table.userId),
        userCreatedAtIdx: index("notifications_user_created_at_idx").on(table.userId, table.createdAt),
        userUnreadCreatedAtIdx: index("notifications_user_is_read_created_at_idx").on(table.userId, table.isRead, table.createdAt),
        createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
    })
);

// ─── DIRECT MESSAGES ─────────────────────────────────────────────────────────

export const directThreads = pgTable(
    "direct_threads",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userAId: uuid("user_a_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        userBId: uuid("user_b_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        userALastReadAt: timestamp("user_a_last_read_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        userBLastReadAt: timestamp("user_b_last_read_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        userAUnreadCount: integer("user_a_unread_count")
            .notNull()
            .default(0),
        userBUnreadCount: integer("user_b_unread_count")
            .notNull()
            .default(0),
        userALastDeliveredSequence: integer("user_a_last_delivered_sequence")
            .notNull()
            .default(0),
        userBLastDeliveredSequence: integer("user_b_last_delivered_sequence")
            .notNull()
            .default(0),
        userALastSeenSequence: integer("user_a_last_seen_sequence")
            .notNull()
            .default(0),
        userBLastSeenSequence: integer("user_b_last_seen_sequence")
            .notNull()
            .default(0),
        nextSequence: integer("next_sequence")
            .notNull()
            .default(1),
        lastMessageId: uuid("last_message_id"),
        lastMessageSequence: integer("last_message_sequence")
            .notNull()
            .default(0),
        lastMessageAt: timestamp("last_message_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        pairUniqueIdx: uniqueIndex("direct_threads_pair_unique_idx").on(table.userAId, table.userBId),
        userALastMessageIdx: index("direct_threads_user_a_last_message_idx").on(table.userAId, table.lastMessageAt),
        userBLastMessageIdx: index("direct_threads_user_b_last_message_idx").on(table.userBId, table.lastMessageAt),
        lastMessageIdIdx: index("direct_threads_last_message_id_idx").on(table.lastMessageId),
        lastMessageIdx: index("direct_threads_last_message_idx").on(table.lastMessageAt),
    })
);

export const directMessages = pgTable(
    "direct_messages",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        threadId: uuid("thread_id")
            .notNull()
            .references(() => directThreads.id, { onDelete: "cascade" }),
        senderId: uuid("sender_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        sequence: integer("sequence").notNull(),
        clientMessageId: varchar("client_message_id", { length: 64 }),
        content: text("content"),
        encryptedPayload: jsonb("encrypted_payload").$type<Record<string, unknown> | null>(),
        mediaUrl: text("media_url"),
        mediaMimeType: varchar("media_mime_type", { length: 64 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        threadCreatedAtIdx: index("direct_messages_thread_created_at_idx").on(table.threadId, table.createdAt),
        threadSequenceUniqueIdx: uniqueIndex("direct_messages_thread_sequence_unique_idx").on(table.threadId, table.sequence),
        senderCreatedAtIdx: index("direct_messages_sender_created_at_idx").on(table.senderId, table.createdAt),
        clientMessageUniqueIdx: uniqueIndex("direct_messages_idempotency_idx").on(
            table.threadId,
            table.senderId,
            table.clientMessageId
        ),
    })
);

// ─── POLLS ───────────────────────────────────────────────────────────────────

export const polls = pgTable(
    "polls",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        postId: uuid("post_id")
            .notNull()
            .references(() => posts.id, { onDelete: "cascade" })
            .unique(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    }
);

export const pollOptions = pgTable(
    "poll_options",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        pollId: uuid("poll_id")
            .notNull()
            .references(() => polls.id, { onDelete: "cascade" }),
        text: varchar("text", { length: 120 }).notNull(),
        voteCount: integer("vote_count").notNull().default(0),
    },
    (table) => ({
        pollIdIdx: index("poll_options_poll_id_idx").on(table.pollId),
    })
);

export const pollVotes = pgTable(
    "poll_votes",
    {
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        pollId: uuid("poll_id")
            .notNull()
            .references(() => polls.id, { onDelete: "cascade" }),
        optionId: uuid("option_id")
            .notNull()
            .references(() => pollOptions.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.userId, table.pollId] }), // One vote per user per poll
        pollIdIdx: index("poll_votes_poll_id_idx").on(table.pollId),
    })
);

export const behavioralAnalyticsEvents = pgTable(
    "behavioral_analytics_events",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id").notNull(),
        eventType: varchar("event_type", { length: 32 }).notNull(),
        surface: varchar("surface", { length: 80 }).notNull(),
        entityType: varchar("entity_type", { length: 32 }),
        entityId: varchar("entity_id", { length: 160 }),
        sessionId: varchar("session_id", { length: 80 }),
        dwellMs: integer("dwell_ms"),
        searchQuery: varchar("search_query", { length: 160 }),
        occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
        receivedAt: timestamp("received_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    },
    (table) => ({
        userOccurredAtIdx: index("behavioral_analytics_events_user_occurred_at_idx").on(table.userId, table.occurredAt),
        eventOccurredAtIdx: index("behavioral_analytics_events_event_occurred_at_idx").on(table.eventType, table.occurredAt),
        entityOccurredAtIdx: index("behavioral_analytics_events_entity_occurred_at_idx").on(table.entityType, table.entityId, table.occurredAt),
        userEventEntityOccurredAtIdx: index("behavioral_analytics_events_user_event_entity_occurred_at_idx").on(table.userId, table.eventType, table.entityType, table.entityId, table.occurredAt),
        entityEventOccurredAtIdx: index("behavioral_analytics_events_entity_event_occurred_at_idx").on(table.entityType, table.eventType, table.entityId, table.occurredAt),
        sessionOccurredAtIdx: index("behavioral_analytics_events_session_occurred_at_idx").on(table.sessionId, table.occurredAt),
        searchOccurredAtIdx: index("behavioral_analytics_events_search_occurred_at_idx").on(table.searchQuery, table.occurredAt),
    })
);

// ─── RELATIONS ───────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
    posts: many(posts),
    interactions: many(interactions),
    following: many(follows, { relationName: "follower" }),
    followers: many(follows, { relationName: "following" }),
    createdCommunities: many(communities),
    communityMemberships: many(communityMembers),
    notificationsReceived: many(notifications, { relationName: "receiver" }),
    notificationsTriggered: many(notifications, { relationName: "actor" }),
    directThreadsAsUserA: many(directThreads, { relationName: "directThreadUserA" }),
    directThreadsAsUserB: many(directThreads, { relationName: "directThreadUserB" }),
    directMessagesSent: many(directMessages),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
    author: one(users, {
        fields: [posts.userId],
        references: [users.id],
    }),
    parent: one(posts, {
        fields: [posts.parentId],
        references: [posts.id],
        relationName: "parentPost",
    }),
    children: many(posts, { relationName: "parentPost" }),
    interactions: many(interactions),
    communities: many(postCommunities),
    notifications: many(notifications),
    poll: one(polls, {
        fields: [posts.id],
        references: [polls.postId],
    }),
}));

export const interactionsRelations = relations(interactions, ({ one }) => ({
    user: one(users, {
        fields: [interactions.userId],
        references: [users.id],
    }),
    post: one(posts, {
        fields: [interactions.postId],
        references: [posts.id],
    }),
}));

export const followsRelations = relations(follows, ({ one }) => ({
    follower: one(users, {
        fields: [follows.followerId],
        references: [users.id],
        relationName: "follower",
    }),
    following: one(users, {
        fields: [follows.followingId],
        references: [users.id],
        relationName: "following",
    }),
}));

export const blocksRelations = relations(blocks, ({ one }) => ({
    blocker: one(users, {
        fields: [blocks.blockerId],
        references: [users.id],
        relationName: "blocker",
    }),
    blocked: one(users, {
        fields: [blocks.blockedId],
        references: [users.id],
        relationName: "blocked",
    }),
}));

export const communitiesRelations = relations(communities, ({ one, many }) => ({
    creator: one(users, {
        fields: [communities.creatorId],
        references: [users.id],
    }),
    members: many(communityMembers),
    joinRequests: many(communityJoinRequests),
    invites: many(communityInvites),
    posts: many(postCommunities),
    rules: many(communityRules),
}));

export const communityMembersRelations = relations(communityMembers, ({ one }) => ({
    community: one(communities, {
        fields: [communityMembers.communityId],
        references: [communities.id],
    }),
    user: one(users, {
        fields: [communityMembers.userId],
        references: [users.id],
    }),
}));

export const communityJoinRequestsRelations = relations(communityJoinRequests, ({ one }) => ({
    community: one(communities, {
        fields: [communityJoinRequests.communityId],
        references: [communities.id],
    }),
    user: one(users, {
        fields: [communityJoinRequests.userId],
        references: [users.id],
    }),
}));

export const communityInvitesRelations = relations(communityInvites, ({ one }) => ({
    community: one(communities, {
        fields: [communityInvites.communityId],
        references: [communities.id],
    }),
    invitedUser: one(users, {
        fields: [communityInvites.invitedUserId],
        references: [users.id],
        relationName: "communityInvitee",
    }),
    inviterUser: one(users, {
        fields: [communityInvites.inviterUserId],
        references: [users.id],
        relationName: "communityInviter",
    }),
}));

export const communityRulesRelations = relations(communityRules, ({ one }) => ({
    community: one(communities, {
        fields: [communityRules.communityId],
        references: [communities.id],
    }),
    creator: one(users, {
        fields: [communityRules.createdBy],
        references: [users.id],
    }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
    user: one(users, {
        fields: [notifications.userId],
        references: [users.id],
        relationName: "receiver",
    }),
    actor: one(users, {
        fields: [notifications.actorId],
        references: [users.id],
        relationName: "actor",
    }),
    post: one(posts, {
        fields: [notifications.postId],
        references: [posts.id],
    }),
    community: one(communities, {
        fields: [notifications.communityId],
        references: [communities.id],
    }),
}));

export const directThreadsRelations = relations(directThreads, ({ one, many }) => ({
    userA: one(users, {
        fields: [directThreads.userAId],
        references: [users.id],
        relationName: "directThreadUserA",
    }),
    userB: one(users, {
        fields: [directThreads.userBId],
        references: [users.id],
        relationName: "directThreadUserB",
    }),
    messages: many(directMessages),
}));

export const directMessagesRelations = relations(directMessages, ({ one }) => ({
    thread: one(directThreads, {
        fields: [directMessages.threadId],
        references: [directThreads.id],
    }),
    sender: one(users, {
        fields: [directMessages.senderId],
        references: [users.id],
    }),
}));

export const pollsRelations = relations(polls, ({ one, many }) => ({
    post: one(posts, {
        fields: [polls.postId],
        references: [posts.id],
    }),
    options: many(pollOptions),
    votes: many(pollVotes),
}));

export const pollOptionsRelations = relations(pollOptions, ({ one, many }) => ({
    poll: one(polls, {
        fields: [pollOptions.pollId],
        references: [polls.id],
    }),
    votes: many(pollVotes),
}));

export const pollVotesRelations = relations(pollVotes, ({ one }) => ({
    user: one(users, {
        fields: [pollVotes.userId],
        references: [users.id],
    }),
    poll: one(polls, {
        fields: [pollVotes.pollId],
        references: [polls.id],
    }),
    option: one(pollOptions, {
        fields: [pollVotes.optionId],
        references: [pollOptions.id],
    }),
}));

// ─── TYPE EXPORTS ────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Interaction = typeof interactions.$inferSelect;
export type NewInteraction = typeof interactions.$inferInsert;
export type Follow = typeof follows.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type Community = typeof communities.$inferSelect;
export type NewCommunity = typeof communities.$inferInsert;
export type CommunityJoinRequest = typeof communityJoinRequests.$inferSelect;
export type CommunityInvite = typeof communityInvites.$inferSelect;
export type CommunityRule = typeof communityRules.$inferSelect;
export type NewCommunityRule = typeof communityRules.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type DirectThread = typeof directThreads.$inferSelect;
export type NewDirectThread = typeof directThreads.$inferInsert;
export type DirectMessage = typeof directMessages.$inferSelect;
export type NewDirectMessage = typeof directMessages.$inferInsert;
export type Poll = typeof polls.$inferSelect;
export type NewPoll = typeof polls.$inferInsert;
export type PollOption = typeof pollOptions.$inferSelect;
export type NewPollOption = typeof pollOptions.$inferInsert;
export type PollVote = typeof pollVotes.$inferSelect;
export type NewPollVote = typeof pollVotes.$inferInsert;
export type BehavioralAnalyticsEventRow = typeof behavioralAnalyticsEvents.$inferSelect;
export type NewBehavioralAnalyticsEventRow = typeof behavioralAnalyticsEvents.$inferInsert;
