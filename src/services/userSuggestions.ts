import { sql } from "drizzle-orm";
import { db } from "../db";

export interface SuggestedUser extends Record<string, unknown> {
    id: string;
    username: string;
    bio: string | null;
    profilePic: string | null;
    role: "admin" | "elite" | "pink" | "user";
    mutualFollowCount: number;
    sharedCommunityCount: number;
    sharedFollowingCount: number;
    sharedFollowerCount: number;
    viewerLikedPostCount: number;
    likedViewerPostCount: number;
    profileViewCount: number;
    followerCount: number;
    recentPostCount: number;
    score: number;
}

export async function getSuggestedUsers(viewerId: string, limit = 6): Promise<SuggestedUser[]> {
    const clampedLimit = Math.min(Math.max(limit, 1), 12);

    const result = await db.execute<SuggestedUser>(sql`
        WITH my_following AS (
            SELECT following_id AS user_id
            FROM follows
            WHERE follower_id = ${viewerId}
        ),
        my_followers AS (
            SELECT follower_id AS user_id
            FROM follows
            WHERE following_id = ${viewerId}
        ),
        my_communities AS (
            SELECT community_id
            FROM community_members
            WHERE user_id = ${viewerId}
        ),
        mutual_follows AS (
            SELECT f.following_id AS candidate_id, COUNT(*)::int AS count
            FROM follows f
            INNER JOIN my_following mf ON mf.user_id = f.follower_id
            WHERE f.following_id <> ${viewerId}
            GROUP BY f.following_id
        ),
        shared_following AS (
            SELECT f.follower_id AS candidate_id, COUNT(*)::int AS count
            FROM my_following mf
            INNER JOIN follows f ON f.following_id = mf.user_id
            WHERE f.follower_id <> ${viewerId}
            GROUP BY f.follower_id
        ),
        shared_followers AS (
            SELECT f.following_id AS candidate_id, COUNT(*)::int AS count
            FROM my_followers mf
            INNER JOIN follows f ON f.follower_id = mf.user_id
            WHERE f.following_id <> ${viewerId}
            GROUP BY f.following_id
        ),
        shared_communities AS (
            SELECT cm.user_id AS candidate_id, COUNT(*)::int AS count
            FROM my_communities mc
            INNER JOIN community_members cm ON cm.community_id = mc.community_id
            WHERE cm.user_id <> ${viewerId}
            GROUP BY cm.user_id
        ),
        viewer_favs AS (
            SELECT p.user_id AS candidate_id, COUNT(*)::int AS count
            FROM interactions i
            INNER JOIN posts p ON p.id = i.post_id
            WHERE i.user_id = ${viewerId}
              AND i.type = 'FAV'
              AND i.created_at >= NOW() - INTERVAL '120 days'
              AND p.user_id <> ${viewerId}
            GROUP BY p.user_id
        ),
        liked_you AS (
            SELECT i.user_id AS candidate_id, COUNT(*)::int AS count
            FROM interactions i
            INNER JOIN posts p ON p.id = i.post_id
            WHERE p.user_id = ${viewerId}
              AND i.type = 'FAV'
              AND i.created_at >= NOW() - INTERVAL '120 days'
              AND i.user_id <> ${viewerId}
            GROUP BY i.user_id
        ),
        viewer_trash AS (
            SELECT p.user_id AS candidate_id, COUNT(*)::int AS count
            FROM interactions i
            INNER JOIN posts p ON p.id = i.post_id
            WHERE i.user_id = ${viewerId}
              AND i.type = 'TRASH'
              AND i.created_at >= NOW() - INTERVAL '120 days'
              AND p.user_id <> ${viewerId}
            GROUP BY p.user_id
        ),
        recent_profile_views AS (
            SELECT u.id AS candidate_id, COUNT(*)::int AS count
            FROM behavioral_analytics_events e
            INNER JOIN users u ON LOWER(u.username) = LOWER(e.entity_id)
            WHERE e.user_id = ${viewerId}
              AND e.event_type = 'profile_view'
              AND e.entity_type = 'user'
              AND e.occurred_at >= NOW() - INTERVAL '30 days'
              AND u.id <> ${viewerId}
            GROUP BY u.id
        ),
        recent_posts AS (
            SELECT p.user_id AS candidate_id, COUNT(*)::int AS count
            FROM posts p
            WHERE p.user_id <> ${viewerId}
              AND p.created_at >= NOW() - INTERVAL '30 days'
            GROUP BY p.user_id
        ),
        candidate_followers AS (
            SELECT following_id AS candidate_id, COUNT(*)::int AS count
            FROM follows
            GROUP BY following_id
        ),
        candidate_stats AS (
            SELECT
                u.id,
                u.username,
                u.bio,
                u.profile_pic AS "profilePic",
                u.role,
                COALESCE(mf.count, 0) AS mutual_follow_count,
                COALESCE(sc.count, 0) AS shared_community_count,
                COALESCE(sf.count, 0) AS shared_following_count,
                COALESCE(sfr.count, 0) AS shared_follower_count,
                COALESCE(vf.count, 0) AS viewer_liked_post_count,
                COALESCE(ly.count, 0) AS liked_viewer_post_count,
                COALESCE(vt.count, 0) AS viewer_trash_count,
                COALESCE(rpv.count, 0) AS profile_view_count,
                COALESCE(rp.count, 0) AS recent_post_count,
                COALESCE(cf.count, 0) AS follower_count,
                CASE WHEN COALESCE(BTRIM(u.bio), '') <> '' THEN 1 ELSE 0 END AS has_bio,
                CASE WHEN COALESCE(BTRIM(u.profile_pic), '') <> '' THEN 1 ELSE 0 END AS has_profile_pic
            FROM users u
            LEFT JOIN mutual_follows mf ON mf.candidate_id = u.id
            LEFT JOIN shared_communities sc ON sc.candidate_id = u.id
            LEFT JOIN shared_following sf ON sf.candidate_id = u.id
            LEFT JOIN shared_followers sfr ON sfr.candidate_id = u.id
            LEFT JOIN viewer_favs vf ON vf.candidate_id = u.id
            LEFT JOIN liked_you ly ON ly.candidate_id = u.id
            LEFT JOIN viewer_trash vt ON vt.candidate_id = u.id
            LEFT JOIN recent_profile_views rpv ON rpv.candidate_id = u.id
            LEFT JOIN recent_posts rp ON rp.candidate_id = u.id
            LEFT JOIN candidate_followers cf ON cf.candidate_id = u.id
            WHERE u.is_active = true
              AND u.id <> ${viewerId}
              AND NOT EXISTS (
                  SELECT 1
                  FROM follows already_following
                  WHERE already_following.follower_id = ${viewerId}
                    AND already_following.following_id = u.id
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM blocks b
                  WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = u.id)
                     OR (b.blocker_id = u.id AND b.blocked_id = ${viewerId})
              )
        ),
        scored_candidates AS (
            SELECT
                cs.*,
                (
                    cs.mutual_follow_count * 45 +
                    cs.shared_community_count * 30 +
                    cs.shared_following_count * 18 +
                    cs.shared_follower_count * 14 +
                    LEAST(cs.profile_view_count, 3) * 10 +
                    cs.viewer_liked_post_count * 12 +
                    cs.liked_viewer_post_count * 16 +
                    LEAST(cs.recent_post_count, 8) * 2 +
                    LEAST(cs.follower_count, 20) * 0.35 +
                    cs.has_bio * 2 +
                    cs.has_profile_pic * 2 -
                    cs.viewer_trash_count * 40
                )::double precision AS score,
                (
                    CASE WHEN cs.mutual_follow_count > 0 THEN 1 ELSE 0 END +
                    CASE WHEN cs.shared_community_count > 0 THEN 1 ELSE 0 END +
                    CASE WHEN cs.shared_following_count > 0 THEN 1 ELSE 0 END +
                    CASE WHEN cs.shared_follower_count > 0 THEN 1 ELSE 0 END +
                    CASE WHEN cs.viewer_liked_post_count > 0 THEN 1 ELSE 0 END +
                    CASE WHEN cs.liked_viewer_post_count > 0 THEN 1 ELSE 0 END +
                    CASE WHEN cs.profile_view_count > 0 THEN 1 ELSE 0 END
                ) AS signal_count
            FROM candidate_stats cs
        )
        SELECT
            id,
            username,
            bio,
            "profilePic",
            role,
            mutual_follow_count AS "mutualFollowCount",
            shared_community_count AS "sharedCommunityCount",
            shared_following_count AS "sharedFollowingCount",
            shared_follower_count AS "sharedFollowerCount",
            viewer_liked_post_count AS "viewerLikedPostCount",
            liked_viewer_post_count AS "likedViewerPostCount",
            profile_view_count AS "profileViewCount",
            follower_count AS "followerCount",
            recent_post_count AS "recentPostCount",
            score
        FROM scored_candidates
        WHERE signal_count > 0
          AND viewer_trash_count = 0
          AND score > 0
        ORDER BY score DESC, follower_count DESC, username ASC
        LIMIT ${clampedLimit}
    `);

    return result.rows;
}
