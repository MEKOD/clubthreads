import { memo, useEffect, useRef, useState } from 'react';
import { BarChart2, CornerDownRight, Heart, MessageCircle, Repeat2, Send, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAvatarUrl, toAbsoluteUrl, toVideoPosterUrl } from '../../lib/axios';
import type { TimelinePost } from '../../lib/social';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { renderContentWithMentions } from '../../lib/mentions';
import { PostMedia } from '../ui/MediaLightbox';
import { PollView } from './PollView';
import { createTimelineNavigationState, withViewTransition } from '../../lib/navigation';
import { LinkPreviewCard } from '../ui/LinkPreviewCard';
import { PostOverflowMenu } from './PostOverflowMenu';
import { isPostHidden } from '../../lib/hiddenPosts';
import { useAuthStore } from '../../store/authStore';
import { isUserBlocked } from '../../lib/blockedUsers';
import { inferAnalyticsSurface, trackAnalyticsEvent } from '../../lib/analytics';
import { InlineReplyInput } from './InlineReplyInput';
import { emitForYouPassiveSignal } from '../../lib/forYouFeedback';
import { warmRouteModule } from '../../lib/routeModules';

function shortTimeAgo(dateStr: string): string {
    const now = Date.now();
    const diff = now - new Date(dateStr).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}sn`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}dk`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}sa`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}g`;
    const months = Math.floor(days / 30);
    return `${months}ay`;
}

function formatMetricCount(value?: number): string {
    const safeValue = Math.max(0, value ?? 0);
    if (safeValue === 0) {
        return '';
    }

    return new Intl.NumberFormat('tr-TR').format(safeValue);
}



interface PostCardProps {
    post: TimelinePost;
    compact?: boolean;
    className?: string;
    hideActions?: boolean;
    feedMode?: 'for_you' | 'latest' | 'trash';
    onInteract?: (postId: string, type: 'fav' | 'trash') => void;
    onRepost?: (postId: string) => void;
    onShare?: (postId: string) => void;
    onReply?: () => void;
}

export const PostCard = memo(function PostCard({
    post,
    compact = false,
    className = '',
    hideActions = false,
    feedMode,
    onInteract,
    onRepost,
    onShare,
    onReply,
}: PostCardProps) {
    const currentUser = useAuthStore((state) => state.user);
    const [hidden, setHidden] = useState(() => isPostHidden(post.id) || isUserBlocked(post.authorUsername));
    const [isInlineReplyOpen, setIsInlineReplyOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const articleRef = useRef<HTMLElement | null>(null);
    const impressionTrackedRef = useRef(false);
    const visibleSinceRef = useRef<number | null>(null);
    const dwellTotalRef = useRef(0);
    const dwellFlushTimeoutRef = useRef<number | null>(null);
    const avatarUrl = getAvatarUrl(post.authorUsername, post.authorProfilePic);
    const mediaUrl = toAbsoluteUrl(post.mediaUrl);
    const isVideo = post.mediaMimeType?.startsWith('video/');
    const posterUrl = isVideo ? toVideoPosterUrl(post.mediaUrl) : null;
    const parentMediaUrl = toAbsoluteUrl(post.parentPreview?.mediaUrl);
    const parentIsVideo = post.parentPreview?.mediaMimeType?.startsWith('video/');
    const parentPosterUrl = parentIsVideo ? toVideoPosterUrl(post.parentPreview?.mediaUrl) : null;
    const hasParentPreview = Boolean(post.parentPreview);
    const isReply = post.type === 'post' && Boolean(post.parentId);
    const isOwner = currentUser?.username === post.authorUsername;
    const formattedViewCount = formatMetricCount(post.viewCount);
    const analyticsSurface = inferAnalyticsSurface(location.pathname);
    const buildDetailState = () => createTimelineNavigationState(location, { scrollY: window.scrollY });
    const emitPassiveSignal = (kind: 'open' | 'dwell', dwellMs?: number, targetPostId = post.id) => {
        if (feedMode !== 'for_you') {
            return;
        }

        emitForYouPassiveSignal({
            kind,
            postId: targetPostId,
            dwellMs,
        });
    };
    const openPostDetail = (targetPostId: string) => {
        emitPassiveSignal('open', undefined, targetPostId);
        warmRouteModule('postDetail');
        navigate(`/post/${targetPostId}`, withViewTransition({ state: buildDetailState() }));
    };

    const flushDwell = () => {
        if (visibleSinceRef.current !== null) {
            dwellTotalRef.current += Date.now() - visibleSinceRef.current;
            visibleSinceRef.current = null;
        }

        if (dwellTotalRef.current >= 1_000) {
            const flushedDwellMs = Math.min(dwellTotalRef.current, 120_000);
            trackAnalyticsEvent({
                eventType: 'post_dwell',
                surface: analyticsSurface,
                entityType: 'post',
                entityId: post.id,
                dwellMs: flushedDwellMs,
            });
            if (flushedDwellMs >= 4_000) {
                emitPassiveSignal('dwell', flushedDwellMs);
            }
            dwellTotalRef.current = 0;
        }
    };

    useEffect(() => {
        const handleUserBlocked = (event: Event) => {
            const blockedUsername = (event as CustomEvent<{ username?: string }>).detail?.username;
            if (blockedUsername === post.authorUsername) {
                setHidden(true);
            }
        };

        const handlePostRemoved = (event: Event) => {
            const removedPostId = (event as CustomEvent<{ postId?: string }>).detail?.postId;
            if (removedPostId === post.id) {
                setHidden(true);
            }
        };

        window.addEventListener('user-blocked', handleUserBlocked);
        window.addEventListener('post-hidden', handlePostRemoved);
        window.addEventListener('post-deleted', handlePostRemoved);

        return () => {
            window.removeEventListener('user-blocked', handleUserBlocked);
            window.removeEventListener('post-hidden', handlePostRemoved);
            window.removeEventListener('post-deleted', handlePostRemoved);
        };
    }, [post.authorUsername, post.id]);

    useEffect(() => {
        const node = articleRef.current;
        if (!node) {
            return;
        }

        const clearImpressionTimeout = () => {
            if (dwellFlushTimeoutRef.current !== null) {
                window.clearTimeout(dwellFlushTimeoutRef.current);
                dwellFlushTimeoutRef.current = null;
            }
        };

        const observer = new IntersectionObserver(
            (entries) => {
                const isVisible = entries[0]?.isIntersecting;
                if (isVisible) {
                    visibleSinceRef.current = visibleSinceRef.current ?? Date.now();
                    if (!impressionTrackedRef.current) {
                        clearImpressionTimeout();
                        dwellFlushTimeoutRef.current = window.setTimeout(() => {
                            impressionTrackedRef.current = true;
                            trackAnalyticsEvent({
                                eventType: 'post_impression',
                                surface: analyticsSurface,
                                entityType: 'post',
                                entityId: post.id,
                            });
                            dwellFlushTimeoutRef.current = null;
                        }, 800);
                    }
                    return;
                }

                clearImpressionTimeout();
                flushDwell();
            },
            { threshold: 0.6 }
        );

        observer.observe(node);

        return () => {
            clearImpressionTimeout();
            observer.disconnect();
            flushDwell();
        };
    }, [analyticsSurface, post.id]);

    if (hidden) {
        return null;
    }

    return (
        <article ref={articleRef} className={`native-feed-card border-b border-border px-4 py-3 transition-colors hover:bg-bg-secondary ${className}`}>
            {isReply && (() => {
                const replyTo = post.parentPreview?.authorUsername
                    || post.content?.match(/^@([a-zA-Z0-9._-]+)/)?.[1]
                    || null;
                return (
                    <Link
                        to={`/post/${post.parentPreview?.id ?? post.parentId}`}
                        onClick={(event) => {
                            event.preventDefault();
                            openPostDetail(post.parentPreview?.id ?? post.parentId ?? post.id);
                        }}
                        className="mb-1.5 ml-[52px] flex items-center gap-1.5 text-[13px] font-medium text-text-secondary hover:text-text-primary transition-colors"
                    >
                        <CornerDownRight size={13} className="opacity-50" />
                        <span className="truncate">{replyTo ? `@${replyTo}'e yanıt` : 'Bir posta yanıt'}</span>
                    </Link>
                );
            })()}
            {(post.type === 'rt' || post.type === 'quote') && (
                <div className="mb-1 ml-[52px] flex items-center gap-1.5 text-[13px] font-bold text-text-secondary">
                    <Repeat2 size={14} />
                    <span>@{post.authorUsername} {post.type === 'quote' ? 'alıntıladı' : 'yeniden paylaştı'}</span>
                </div>
            )}

            <div className="flex gap-3">
                {/* Avatar with thread connector line for replies */}
                <div className="relative flex-shrink-0">
                    {isReply && hasParentPreview && (
                        <div className="absolute left-1/2 top-[44px] h-[calc(100%-44px)] w-px -translate-x-1/2 bg-border-subtle/60" />
                    )}
                    <Link
                        to={`/users/${post.authorUsername}`}
                        viewTransition
                        className="relative z-10 block"
                        onClick={() => trackAnalyticsEvent({
                            eventType: 'profile_view',
                            surface: analyticsSurface,
                            entityType: 'user',
                            entityId: post.authorUsername,
                        })}
                    >
                        <div className="h-10 w-10 overflow-hidden rounded-full bg-border">
                            <img src={avatarUrl} alt={post.authorUsername} className="h-full w-full object-cover" />
                        </div>
                    </Link>
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px] leading-5">
                            <Link
                                to={`/users/${post.authorUsername}`}
                                viewTransition
                                className="flex min-w-0 max-w-full items-center gap-0.5 font-bold text-text-primary hover:underline"
                                onClick={() => trackAnalyticsEvent({
                                    eventType: 'profile_view',
                                    surface: analyticsSurface,
                                    entityType: 'user',
                                    entityId: post.authorUsername,
                                })}
                            >
                                <span className="truncate">@{post.authorUsername}</span>
                                <VerifiedBadge role={post.authorRole} />
                            </Link>
                            {post.communitySlug && (
                                <>
                                    <span className="text-text-secondary">·</span>
                                    <Link
                                        to={`/communities/${post.communitySlug}`}
                                        viewTransition
                                        className="max-w-full shrink-0 rounded-full border border-border-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary transition hover:border-text-primary/15 hover:text-text-primary"
                                        onClick={() => trackAnalyticsEvent({
                                            eventType: 'community_view',
                                            surface: analyticsSurface,
                                            entityType: 'community',
                                            entityId: post.communitySlug ?? '',
                                        })}
                                    >
                                        /{post.communitySlug}
                                    </Link>
                                </>
                            )}
                            <span className="text-text-secondary">·</span>
                            <span className="shrink-0 whitespace-nowrap text-text-secondary hover:underline">
                                {shortTimeAgo(post.createdAt)}
                            </span>
                        </div>
                        <PostOverflowMenu
                            postId={post.id}
                            authorUsername={post.authorUsername}
                            content={post.content}
                            isOwner={Boolean(isOwner)}
                            onDeleted={() => setHidden(true)}
                            onBlocked={() => setHidden(true)}
                            onHidden={() => setHidden(true)}
                        />
                    </div>

                    {post.type !== 'rt' && (
                        <div
                            role="link"
                            tabIndex={0}
                            onClick={() => openPostDetail(post.id)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    openPostDetail(post.id);
                                }
                            }}
                            className="block cursor-pointer"
                        >
                            {post.content && (
                                <p className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-text-primary ${compact ? 'line-clamp-3 text-[14px] leading-5' : 'mt-0.5 text-[15px] leading-[20px]'}`}>
                                    {renderContentWithMentions(post.content)}
                                </p>
                            )}
                        </div>
                    )}

                    {post.type !== 'rt' && post.linkPreview && (
                        <LinkPreviewCard preview={post.linkPreview} compact={compact} />
                    )}

                    {post.poll && (
                        <div className="mt-2 text-left">
                            <PollView poll={post.poll} />
                        </div>
                    )}

                    {post.type === 'rt' && hasParentPreview && (
                        <Link
                            to={`/post/${post.parentPreview?.id}`}
                            onClick={(event) => {
                                event.preventDefault();
                                openPostDetail(post.parentPreview?.id ?? post.id);
                            }}
                            className="mt-2 block rounded-2xl border border-border p-3 transition hover:bg-bg-secondary"
                        >
                            <div className="flex items-center gap-1 text-[13px]">
                                <span className="font-bold text-text-primary">@{post.parentPreview?.authorUsername}</span>
                            </div>
                            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[14px] leading-5 text-text-primary">
                                {post.parentPreview?.content || 'Medyalı postu aç'}
                            </p>
                            {parentMediaUrl && (
                                <div className="mt-2">
                                    <PostMedia src={parentMediaUrl} posterSrc={parentPosterUrl ?? undefined} isVideo={!!parentIsVideo} alt="RT medya" compact />
                                </div>
                            )}
                        </Link>
                    )}

                    {post.type === 'quote' && hasParentPreview && (
                        <Link
                            to={`/post/${post.parentPreview?.id}`}
                            onClick={(event) => {
                                event.preventDefault();
                                openPostDetail(post.parentPreview?.id ?? post.id);
                            }}
                            className="mt-2 block rounded-2xl border border-border p-3 transition hover:bg-bg-secondary"
                        >
                            <div className="flex items-center gap-1 text-[13px]">
                                <span className="font-bold text-text-primary">@{post.parentPreview?.authorUsername}</span>
                            </div>
                            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[14px] leading-5 text-text-primary">
                                {post.parentPreview?.content || 'Medyalı postu aç'}
                            </p>
                            {parentMediaUrl && (
                                <div className="mt-2">
                                    <PostMedia src={parentMediaUrl} posterSrc={parentPosterUrl ?? undefined} isVideo={!!parentIsVideo} alt="Quote medya" compact />
                                </div>
                            )}
                        </Link>
                    )}

                    {isReply && hasParentPreview && (() => {
                        const ppMedia = toAbsoluteUrl(post.parentPreview?.mediaUrl);
                        const ppIsVideo = post.parentPreview?.mediaMimeType?.startsWith('video/');
                        return (
                            <Link
                                to={`/post/${post.parentPreview?.id}`}
                                onClick={(event) => {
                                    event.preventDefault();
                                    openPostDetail(post.parentPreview?.id ?? post.id);
                                }}
                                className="mt-2.5 block overflow-hidden rounded-2xl border border-border bg-bg-secondary/50 transition hover:bg-bg-hover"
                            >
                                <div className="border-l-[3px] border-brand/30 px-3.5 py-2.5">
                                    {post.parentPreview?.parentAuthorUsername && (
                                        <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                                            <CornerDownRight size={10} className="opacity-40" />
                                            <span>@{post.parentPreview.parentAuthorUsername}'e yan&#305;t olarak</span>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <img
                                            src={getAvatarUrl(post.parentPreview?.authorUsername, post.parentPreview?.authorProfilePic)}
                                            alt={post.parentPreview?.authorUsername ?? ''}
                                            className="h-6 w-6 rounded-full object-cover ring-1 ring-border-subtle"
                                        />
                                        <span className="text-[13px] font-bold text-text-primary">@{post.parentPreview?.authorUsername}</span>
                                    </div>
                                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[14px] leading-[20px] text-text-primary/85">
                                        {post.parentPreview?.content || 'Postu a\u00e7'}
                                    </p>
                                    {ppMedia && (
                                        <div className="mt-2 overflow-hidden rounded-xl">
                                            {ppIsVideo ? (
                                                <div className="flex h-16 items-center justify-center bg-black/5 text-[12px] text-text-muted">&#9654; Video</div>
                                            ) : (
                                                <img src={ppMedia} alt="" className="h-20 w-full object-cover" />
                                            )}
                                        </div>
                                    )}
                                </div>
                            </Link>
                        );
                    })()}

                    {post.type !== 'rt' && mediaUrl && (
                        <PostMedia src={mediaUrl} posterSrc={posterUrl ?? undefined} isVideo={!!isVideo} alt="Post medya" compact={compact} />
                    )}

                    {!hideActions && (
                        <>

                            <div className={`-ml-2 mt-1 flex max-w-[460px] items-center justify-between text-text-secondary`}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!currentUser) {
                                            warmRouteModule('postDetail');
                                            navigate(`/post/${post.id}`, withViewTransition({ state: buildDetailState() }));
                                            return;
                                        }
                                        trackAnalyticsEvent({
                                            eventType: 'post_reply_start',
                                            surface: analyticsSurface,
                                            entityType: 'post',
                                            entityId: post.id,
                                        });
                                        setIsInlineReplyOpen((prev) => !prev);
                                    }}
                                    className={`group/btn flex items-center gap-1 rounded-full p-2 text-[13px] transition-colors hover:bg-brand/10 hover:text-brand ${isInlineReplyOpen ? 'text-brand bg-brand/10' : ''}`}
                                >
                                    <MessageCircle size={18} />
                                    {post.replyCount > 0 ? (
                                        <span
                                            role="link"
                                            tabIndex={0}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openPostDetail(post.id);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.stopPropagation();
                                                    openPostDetail(post.id);
                                                }
                                            }}
                                            className="hover:underline"
                                        >
                                            {post.replyCount}
                                        </span>
                                    ) : null}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => onRepost?.(post.id)}
                                    className="group/btn flex items-center gap-1 rounded-full p-2 text-[13px] transition-colors hover:bg-[#00ba7c]/10 hover:text-[#00ba7c]"
                                >
                                    <Repeat2 size={18} />
                                    <span>{(post.rtCount ?? 0) > 0 ? post.rtCount : ''}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        trackAnalyticsEvent({
                                            eventType: 'post_like',
                                            surface: analyticsSurface,
                                            entityType: 'post',
                                            entityId: post.id,
                                        });
                                        onInteract?.(post.id, 'fav');
                                    }}
                                    className={`group/btn flex items-center gap-1 rounded-full p-2 text-[13px] transition-colors hover:bg-[#f91880]/10 hover:text-[#f91880] ${post.hasFav ? 'text-[#f91880]' : ''}`}
                                >
                                    <Heart size={18} fill={post.hasFav ? 'currentColor' : 'none'} />
                                    <span>{post.favCount > 0 ? post.favCount : ''}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        trackAnalyticsEvent({
                                            eventType: 'post_trash',
                                            surface: analyticsSurface,
                                            entityType: 'post',
                                            entityId: post.id,
                                        });
                                        onInteract?.(post.id, 'trash');
                                    }}
                                    className={`group/btn flex items-center gap-1 rounded-full p-2 text-[13px] transition-colors hover:bg-[#ff6723]/10 hover:text-[#ff6723] ${post.hasTrash ? 'text-[#ff6723]' : ''}`}
                                >
                                    <Trash2 size={18} fill={post.hasTrash ? 'currentColor' : 'none'} />
                                    <span>{post.trashCount > 0 ? post.trashCount : ''}</span>
                                </button>

                                <div
                                    className="flex items-center gap-1 rounded-full p-2 text-[13px] text-text-secondary"
                                    title={formattedViewCount ? `${formattedViewCount} goruntulenme` : undefined}
                                >
                                    <BarChart2 size={18} />
                                    <span>{formattedViewCount}</span>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => {
                                        trackAnalyticsEvent({
                                            eventType: 'post_share',
                                            surface: analyticsSurface,
                                            entityType: 'post',
                                            entityId: post.id,
                                        });
                                        onShare?.(post.id);
                                    }}
                                    className="group/btn rounded-full p-2 transition-colors hover:bg-brand/10 hover:text-brand"
                                >
                                    <Send size={18} />
                                </button>
                            </div>

                            {isInlineReplyOpen && (
                                <InlineReplyInput
                                    postId={post.id}
                                    authorUsername={post.authorUsername}
                                    onReplied={() => {
                                        onReply?.();
                                    }}
                                    onClose={() => setIsInlineReplyOpen(false)}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>
        </article>
    );
});
