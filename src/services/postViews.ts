import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { behavioralAnalyticsEvents } from "../db/schema";

type PostWithOptionalViews = {
    id: string;
    viewCount?: number | null;
};

export async function attachPostViewCounts<T extends PostWithOptionalViews>(posts: T[]): Promise<Array<T & { viewCount: number }>> {
    if (posts.length === 0) {
        return posts.map((post) => ({
            ...post,
            viewCount: 0,
        }));
    }

    const postIds = [...new Set(posts.map((post) => post.id).filter(Boolean))];
    const rows = postIds.length > 0
        ? await db
            .select({
                postId: behavioralAnalyticsEvents.entityId,
                viewCount: sql<number>`COUNT(*)::int`,
            })
            .from(behavioralAnalyticsEvents)
            .where(
                and(
                    eq(behavioralAnalyticsEvents.entityType, "post"),
                    eq(behavioralAnalyticsEvents.eventType, "post_impression"),
                    inArray(behavioralAnalyticsEvents.entityId, postIds)
                )
            )
            .groupBy(behavioralAnalyticsEvents.entityId)
        : [];

    const viewCountByPostId = new Map(
        rows.map((row) => [row.postId, Number(row.viewCount) || 0])
    );

    return posts.map((post) => ({
        ...post,
        viewCount: Number(post.viewCount) || viewCountByPostId.get(post.id) || 0,
    }));
}
