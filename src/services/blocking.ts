import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import { db } from "../db";
import { blocks, follows } from "../db/schema";

export function buildViewerBlockFilter(viewerId: string | undefined, targetUserId: SQLWrapper) {
    if (!viewerId) {
        return sql`true`;
    }

    return sql`NOT EXISTS (
        SELECT 1
        FROM ${blocks}
        WHERE ${blocks.blockerId} = ${viewerId}
          AND ${blocks.blockedId} = ${targetUserId}
    )`;
}

export async function hasBlockRelation(blockerId: string, blockedId: string) {
    const [row] = await db
        .select({ blockerId: blocks.blockerId })
        .from(blocks)
        .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
        .limit(1);

    return Boolean(row);
}

export async function removeFollowEdgesBetweenUsers(userA: string, userB: string) {
    await db
        .delete(follows)
        .where(
            sql`(${follows.followerId} = ${userA} AND ${follows.followingId} = ${userB})
                OR (${follows.followerId} = ${userB} AND ${follows.followingId} = ${userA})`
        );
}
