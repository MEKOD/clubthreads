import { Check, Loader2, Shield, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAvatarUrl } from '../../lib/axios';
import type { CommunityJoinRequest, CommunityMember } from '../../lib/social';

interface ModerationInvite {
    userId: string;
    username: string;
    profilePic: string | null;
    bio: string | null;
    invitedAt: string;
}

interface CommunityMembersTabProps {
    canModerate: boolean;
    canManage: boolean;
    members: CommunityMember[];
    invites: ModerationInvite[];
    pendingRequests: CommunityJoinRequest[];
    inviteUsername: string;
    inviteLoading: boolean;
    requestActionUserId: string | null;
    roleActionUserId: string | null;
    onInviteUsernameChange: (value: string) => void;
    onInvite: () => void;
    onRequestAction: (userId: string, action: 'approve' | 'reject') => void;
    onRoleChange: (userId: string, role: 'moderator' | 'member') => void;
}

export function CommunityMembersTab({
    canModerate,
    canManage,
    members,
    invites,
    pendingRequests,
    inviteUsername,
    inviteLoading,
    requestActionUserId,
    roleActionUserId,
    onInviteUsernameChange,
    onInvite,
    onRequestAction,
    onRoleChange,
}: CommunityMembersTabProps) {
    return (
        <div className="space-y-4">
            {canModerate && (
                <div className="rounded-[24px] border border-black/[0.06] bg-bg-primary/95 p-4 shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                    <div className="text-sm font-semibold text-text-primary">Birini davet et</div>
                    <div className="mt-3 flex gap-2">
                        <input
                            value={inviteUsername}
                            onChange={(event) => onInviteUsernameChange(event.target.value)}
                            placeholder="@kullaniciadi"
                            className="min-w-0 flex-1 rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm outline-none placeholder:text-text-muted focus:border-black/20"
                        />
                        <button
                            type="button"
                            onClick={onInvite}
                            disabled={inviteLoading || !inviteUsername.trim()}
                            className="rounded-full bg-text-primary px-4 py-2.5 text-sm font-semibold text-inverse-primary disabled:opacity-50"
                        >
                            {inviteLoading ? <Loader2 size={16} className="animate-spin" /> : 'Davet et'}
                        </button>
                    </div>
                </div>
            )}

            {canModerate && pendingRequests.length > 0 && (
                <div className="rounded-[24px] border border-black/[0.06] bg-bg-primary/95 p-4 shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                    <div className="mb-3 text-sm font-semibold text-text-primary">Bekleyen istekler</div>
                    <div className="space-y-3">
                        {pendingRequests.map((request) => (
                            <div key={request.userId} className="flex items-center gap-3 rounded-2xl bg-bg-secondary/70 p-3">
                                <div className="h-11 w-11 overflow-hidden rounded-2xl bg-bg-secondary">
                                    <img src={getAvatarUrl(request.username, request.profilePic)} alt={request.username} className="h-full w-full object-cover" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-text-primary">@{request.username}</div>
                                    {request.bio && <div className="mt-1 line-clamp-1 text-xs text-text-secondary">{request.bio}</div>}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRequestAction(request.userId, 'approve')}
                                    disabled={requestActionUserId === request.userId}
                                    className="rounded-full bg-text-primary p-2 text-inverse-primary disabled:opacity-50"
                                >
                                    <Check size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onRequestAction(request.userId, 'reject')}
                                    disabled={requestActionUserId === request.userId}
                                    className="rounded-full border border-border-subtle p-2 text-text-secondary disabled:opacity-50"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {canModerate && invites.length > 0 && (
                <div className="rounded-[24px] border border-black/[0.06] bg-bg-primary/95 p-4 shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                    <div className="mb-3 text-sm font-semibold text-text-primary">Gonderilen davetler</div>
                    <div className="space-y-3">
                        {invites.map((invite) => (
                            <div key={invite.userId} className="flex items-center gap-3 rounded-2xl bg-bg-secondary/70 p-3">
                                <div className="h-11 w-11 overflow-hidden rounded-2xl bg-bg-secondary">
                                    <img src={getAvatarUrl(invite.username, invite.profilePic)} alt={invite.username} className="h-full w-full object-cover" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-text-primary">@{invite.username}</div>
                                    {invite.bio && <div className="mt-1 line-clamp-1 text-xs text-text-secondary">{invite.bio}</div>}
                                </div>
                                <span className="rounded-full border border-border-subtle px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                                    Davet bekliyor
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
                {members.map((member) => (
                    <div
                        key={member.userId}
                        className="rounded-[24px] border border-black/[0.06] bg-bg-primary/95 p-4 shadow-[0_8px_32px_rgba(17,17,17,0.04)]"
                    >
                        <div className="flex items-center gap-3">
                            <Link to={`/users/${member.username}`} className="h-12 w-12 overflow-hidden rounded-2xl bg-bg-secondary">
                                <img src={getAvatarUrl(member.username, member.profilePic)} alt={member.username} className="h-full w-full object-cover" />
                            </Link>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <Link to={`/users/${member.username}`} className="truncate text-sm font-semibold text-text-primary hover:underline">
                                        @{member.username}
                                    </Link>
                                    <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                                        {member.role}
                                    </span>
                                </div>
                                {member.bio && (
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">{member.bio}</p>
                                )}
                            </div>
                        </div>

                        {canManage && member.role !== 'owner' && (
                            <div className="mt-3 flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => onRoleChange(member.userId, member.role === 'moderator' ? 'member' : 'moderator')}
                                    disabled={roleActionUserId === member.userId}
                                    className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:bg-bg-secondary disabled:opacity-50"
                                >
                                    <Shield size={12} />
                                    {member.role === 'moderator' ? 'Member yap' : 'Moderator yap'}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
