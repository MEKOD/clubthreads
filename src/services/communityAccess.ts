import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { communities, communityMembers } from "../db/schema";

export type CommunityRole = "owner" | "moderator" | "member";

export interface CommunityAccess {
    community: {
        id: string;
        slug: string;
        creatorId: string;
        isPrivate: boolean;
    };
    membership: {
        role: CommunityRole;
    } | null;
    isMember: boolean;
    canView: boolean;
    canPost: boolean;
    canModerate: boolean;
    canManage: boolean;
    canDelete: boolean;
}

const ROLE_RANK: Record<CommunityRole, number> = {
    member: 1,
    moderator: 2,
    owner: 3,
};

function buildAccess(row: {
    id: string;
    slug: string;
    creatorId: string;
    isPrivate: boolean;
    membershipRole: CommunityRole | null;
}): CommunityAccess {
    const community = {
        id: row.id,
        slug: row.slug,
        creatorId: row.creatorId,
        isPrivate: row.isPrivate,
    };

    const membership: CommunityAccess["membership"] = row.membershipRole
        ? { role: row.membershipRole }
        : null;

    const role = membership?.role ?? null;
    const isMember = Boolean(role);
    const roleRank = role ? ROLE_RANK[role] : 0;
    const canView = !community.isPrivate || isMember;

    return {
        community,
        membership,
        isMember,
        canView,
        canPost: isMember,
        canModerate: roleRank >= ROLE_RANK.moderator,
        canManage: roleRank >= ROLE_RANK.owner,
        canDelete: roleRank >= ROLE_RANK.owner,
    };
}

export async function getCommunityAccessById(communityId: string, userId?: string): Promise<CommunityAccess | null> {
    const [row] = await db
        .select({
            id: communities.id,
            slug: communities.slug,
            creatorId: communities.creatorId,
            isPrivate: communities.isPrivate,
            membershipRole: communityMembers.role,
        })
        .from(communities)
        .leftJoin(
            communityMembers,
            userId
                ? and(eq(communityMembers.communityId, communities.id), eq(communityMembers.userId, userId))
                : sql`false`
        )
        .where(eq(communities.id, communityId))
        .limit(1);

    if (!row) return null;
    return buildAccess(row);
}

export async function getCommunityAccessBySlug(slug: string, userId?: string): Promise<CommunityAccess | null> {
    const [row] = await db
        .select({
            id: communities.id,
            slug: communities.slug,
            creatorId: communities.creatorId,
            isPrivate: communities.isPrivate,
            membershipRole: communityMembers.role,
        })
        .from(communities)
        .leftJoin(
            communityMembers,
            userId
                ? and(eq(communityMembers.communityId, communities.id), eq(communityMembers.userId, userId))
                : sql`false`
        )
        .where(eq(communities.slug, slug))
        .limit(1);

    if (!row) return null;
    return buildAccess(row);
}

export function hasCommunityRole(access: Pick<CommunityAccess, "membership">, minimumRole: CommunityRole): boolean {
    const currentRole = access.membership?.role;
    if (!currentRole) return false;
    return ROLE_RANK[currentRole] >= ROLE_RANK[minimumRole];
}
