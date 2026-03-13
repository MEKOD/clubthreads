import { ArrowLeft, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CommunityDetail } from '../../lib/social';
import { toAbsoluteUrl } from '../../lib/axios';

interface CommunityHeaderProps {
    community: CommunityDetail;
    onBackHref?: string;
    joinLoading?: boolean;
    onJoinToggle?: () => void;
    onInviteReject?: () => void;
}

export function CommunityHeader({
    community,
    onBackHref = '/communities?hub=1',
    joinLoading = false,
    onJoinToggle,
    onInviteReject,
}: CommunityHeaderProps) {
    const showInviteActions = Boolean(onJoinToggle && community.hasInvite && !community.isMember);

    return (
        <div className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))] z-20 border-b border-border-subtle bg-bg-primary/96 px-2 pb-3 pt-2 backdrop-blur md:top-0 md:px-0">
            <div className="flex flex-col gap-3 px-2 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <Link
                        to={onBackHref}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition hover:bg-bg-secondary hover:text-text-primary"
                        aria-label="Community hub"
                    >
                        <ArrowLeft size={18} />
                    </Link>

                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-secondary text-sm font-black text-text-primary">
                        {community.avatarUrl ? (
                            <img src={toAbsoluteUrl(community.avatarUrl) ?? undefined} alt={community.name} className="h-full w-full object-cover" />
                        ) : (
                            community.name[0]?.toUpperCase()
                        )}
                    </div>

                    <div className="min-w-0">
                        <div className="truncate text-lg font-semibold text-text-primary">{community.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                            <span>{community.memberCount} uye</span>
                            <span>{community.isPrivate ? 'private' : 'public'}</span>
                            {community.viewerRole && <span>{community.viewerRole}</span>}
                        </div>
                    </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-2 md:gap-3">
                    {showInviteActions ? (
                        <div className="flex w-full items-center gap-2 md:w-auto">
                            <button
                                type="button"
                                onClick={onInviteReject}
                                disabled={joinLoading}
                                className="flex-1 rounded-full border border-border-subtle px-3 py-2 text-xs font-medium text-text-secondary transition hover:bg-bg-secondary disabled:opacity-50 md:flex-none md:px-3 md:py-1.5"
                            >
                                Reddet
                            </button>
                            <button
                                type="button"
                                onClick={onJoinToggle}
                                disabled={joinLoading}
                                className="flex-1 rounded-full bg-text-primary px-3 py-2 text-xs font-medium text-inverse-primary disabled:opacity-50 md:flex-none md:px-3 md:py-1.5"
                            >
                                {joinLoading ? <Loader2 size={14} className="animate-spin" /> : 'Kabul et'}
                            </button>
                        </div>
                    ) : onJoinToggle && (
                        <button
                            type="button"
                            onClick={onJoinToggle}
                            disabled={joinLoading || Boolean(community.hasRequestedJoin)}
                            className="w-full rounded-full border border-border-subtle px-3 py-2 text-xs font-medium text-text-primary transition hover:bg-bg-secondary disabled:opacity-50 md:w-auto md:px-3 md:py-1.5"
                        >
                            {joinLoading ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : community.isMember ? (
                                'Ayril'
                            ) : community.hasRequestedJoin ? (
                                'Istek gonderildi'
                            ) : community.hasInvite ? (
                                'Daveti kabul et'
                            ) : (
                                'Istek gonder'
                            )}
                        </button>
                    )}
                </div>
            </div>

            {(community.description || community.slug) && (
                <div className="mt-1 px-2 text-sm text-text-secondary">
                    <span className="font-medium text-text-primary">/{community.slug}</span>
                    {community.description ? <span className="mt-1 block md:ml-2 md:mt-0 md:inline">{community.description}</span> : null}
                </div>
            )}
        </div>
    );
}
