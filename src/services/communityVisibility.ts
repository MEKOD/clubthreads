import { sql, type SQLWrapper } from "drizzle-orm";
import { communities, communityMembers, postCommunities, posts } from "../db/schema";
import { buildViewerBlockFilter } from "./blocking";

export function buildVisiblePostFilter(viewerId?: string, authorIdColumn: SQLWrapper = posts.userId) {
    if (!viewerId) {
        return sql`(
            ${postCommunities.communityId} IS NULL
            OR ${communities.isPrivate} = false
        )`;
    }

    return sql`(
        ${postCommunities.communityId} IS NULL
        OR ${communities.isPrivate} = false
        OR EXISTS(
            SELECT 1
            FROM ${communityMembers}
            WHERE ${communityMembers.communityId} = ${postCommunities.communityId}
              AND ${communityMembers.userId} = ${viewerId}
        )
    ) AND ${buildViewerBlockFilter(viewerId, authorIdColumn)}`;
}
