import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Heart, Loader2, MessageCircle, Repeat2, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAvatarUrl, toAbsoluteUrl, toVideoPosterUrl } from '../../lib/axios';
import { renderContentWithMentions } from '../../lib/mentions';
import { createTimelineNavigationState, withViewTransition } from '../../lib/navigation';
import { type User } from '../../store/authStore';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { PostMedia } from '../ui/MediaLightbox';
import { PostOverflowMenu } from '../feed/PostOverflowMenu';
import { MentionTextarea } from '../ui/MentionTextarea';

interface ReplyPost {
    id: string;
    parentId: string | null;
    content: string | null;
    favCount: number;
    trashCount: number;
    replyCount?: number;
    rtCount?: number;
    createdAt: string;
    authorUsername: string;
    authorProfilePic: string | null;
    authorRole?: 'user' | 'elite' | 'admin';
    mediaUrl?: string | null;
    mediaMimeType?: string | null;
    hasFav?: boolean;
    hasTrash?: boolean;
    depth: number;
}

interface ContextPost {
    id: string;
    authorUsername: string;
    content: string | null;
}

interface ThreadReplyListProps {
    replies: ReplyPost[];
    contextPool: ContextPost[];
    currentUser: User | null;
    replyingToId: string | null;
    nestedReplyContent: string;
    isSubmittingNested: boolean;
    nestedReplyTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
    onReplyInteract: (replyId: string, type: 'fav' | 'trash') => void;
    onReplyRepost: (replyId: string) => void;
    onStartReply: (replyId: string, username: string) => void;
    onNestedReplyChange: (value: string) => void;
    onNestedReplySubmit: (event: React.FormEvent<HTMLFormElement>, parentReplyId: string) => void;
}

export function ThreadReplyList({
    replies,
    contextPool,
    currentUser,
    replyingToId,
    nestedReplyContent,
    isSubmittingNested,
    nestedReplyTextareaRef,
    onReplyInteract,
    onReplyRepost,
    onStartReply,
    onNestedReplyChange,
    onNestedReplySubmit,
}: ThreadReplyListProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const [hiddenReplyIds, setHiddenReplyIds] = useState<string[]>([]);
    const contextById = new Map(contextPool.map((item) => [item.id, item]));
    const getIndent = (depth: number) => Math.min(depth, 2) * 16;
    const visibleReplies = replies.filter((reply) => !hiddenReplyIds.includes(reply.id));
    const buildDetailState = () => createTimelineNavigationState(location, { scrollY: window.scrollY });

    if (visibleReplies.length === 0) {
        return (
            <div className="p-8 text-center text-text-secondary">
                Henüz yanıt yok.
            </div>
        );
    }

    return (
        <>
            {visibleReplies.map((reply) => (
                <React.Fragment key={reply.id}>
                    <div className="relative" style={{ paddingLeft: `${getIndent(reply.depth)}px` }}>
                        {reply.depth > 0 && (
                            <div
                                className="absolute bottom-0 top-0 w-px bg-border-subtle"
                                style={{ left: `${Math.max(getIndent(reply.depth) - 8, 0)}px` }}
                            />
                        )}

                        <article
                            onClick={() => navigate(`/post/${reply.id}`, withViewTransition({ state: buildDetailState() }))}
                            className="native-feed-card flex cursor-pointer gap-3 p-4 transition-colors hover:bg-bg-secondary/50"
                        >
                            <Link onClick={(e) => e.stopPropagation()} to={`/users/${reply.authorUsername}`} className="flex-shrink-0">
                                <div className="w-10 h-10 rounded-full overflow-hidden bg-bg-hover">
                                    <img
                                        src={getAvatarUrl(reply.authorUsername, reply.authorProfilePic)}
                                        alt={reply.authorUsername}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            </Link>

                            <div className="flex-1 min-w-0">
                                <div className="mb-1 flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                        <Link onClick={(e) => e.stopPropagation()} to={`/users/${reply.authorUsername}`} className="flex items-center gap-1 font-bold text-text-primary hover:underline">
                                            {reply.authorUsername}
                                            <VerifiedBadge role={reply.authorRole} />
                                        </Link>
                                        <span className="truncate text-sm text-text-secondary">@{reply.authorUsername}</span>
                                        <span className="text-sm text-text-muted">·</span>
                                        <span className="text-sm text-text-secondary">
                                            {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true }).replace('about ', '')}
                                        </span>
                                        {reply.depth > 1 && (
                                            <>
                                                <span className="text-sm text-text-muted">·</span>
                                                <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                                                    Thread
                                                </span>
                                            </>
                                        )}
                                    </div>
                                    <PostOverflowMenu
                                        postId={reply.id}
                                        authorUsername={reply.authorUsername}
                                        content={reply.content}
                                        isOwner={currentUser?.username === reply.authorUsername}
                                        onDeleted={() => setHiddenReplyIds((current) => [...current, reply.id])}
                                        onBlocked={() => setHiddenReplyIds((current) => [...current, reply.id])}
                                        onHidden={() => setHiddenReplyIds((current) => [...current, reply.id])}
                                    />
                                </div>

                                {(() => {
                                    const contextPost = reply.parentId ? contextById.get(reply.parentId) : null;

                                    return (
                                        <>
                                            {contextPost && (
                                                <div className="mb-2 mt-1 -ml-1 inline-block max-w-full rounded-2xl border border-border-subtle bg-bg-secondary px-3 py-2 transition hover:bg-bg-hover" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                                                        <span className="font-semibold text-text-primary">@{contextPost.authorUsername}</span>
                                                        söyledi:
                                                    </div>
                                                    <div className="line-clamp-2 break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-text-secondary">
                                                        "{contextPost.content || 'Medyalı yanıt'}"
                                                    </div>
                                                </div>
                                            )}
                                            {reply.content && (
                                                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[15px] leading-relaxed text-text-primary">{renderContentWithMentions(reply.content)}</p>
                                            )}
                                        </>
                                    );
                                })()}

                                {reply.mediaUrl && (
                                    <div className="mt-2 text-left">
                                        <PostMedia
                                            src={toAbsoluteUrl(reply.mediaUrl) as string}
                                            posterSrc={toVideoPosterUrl(reply.mediaUrl) ?? undefined}
                                            isVideo={reply.mediaMimeType?.startsWith('video/') ?? false}
                                            alt="Yanıt medyası"
                                        />
                                    </div>
                                )}

                                <div className="mt-3 flex max-w-sm items-center justify-between text-text-secondary">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onStartReply(reply.id, reply.authorUsername);
                                        }}
                                        className="flex items-center gap-1.5 transition-colors hover:text-text-primary"
                                    >
                                        <div className="rounded-full p-1.5 group-hover:bg-bg-hover"><MessageCircle size={16} /></div>
                                    </button>

                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onReplyRepost(reply.id);
                                        }}
                                        className="flex items-center gap-1.5 transition-colors hover:text-text-primary"
                                    >
                                        <div className="rounded-full p-1.5 group-hover:bg-[#eef7cb]"><Repeat2 size={16} /></div>
                                        <span className="text-xs font-medium">{(reply.rtCount ?? 0) || ''}</span>
                                    </button>

                                    <button onClick={(e) => { e.stopPropagation(); onReplyInteract(reply.id, 'fav'); }} className={`flex items-center gap-1.5 transition-colors ${reply.hasFav ? 'text-[#d14b3b]' : 'hover:text-[#d14b3b]'}`}>
                                        <div className="rounded-full p-1.5 group-hover:bg-[#ffe5df]"><Heart size={16} fill={reply.hasFav ? 'currentColor' : 'none'} /></div>
                                        <span className="text-xs font-medium">{reply.favCount || ''}</span>
                                    </button>

                                    <button onClick={(e) => { e.stopPropagation(); onReplyInteract(reply.id, 'trash'); }} className={`flex items-center gap-1.5 transition-colors ${reply.hasTrash ? 'text-red-500' : 'hover:text-red-500'}`}>
                                        <div className="rounded-full p-1.5 group-hover:bg-red-50"><Trash2 size={16} fill={reply.hasTrash ? 'currentColor' : 'none'} /></div>
                                        <span className="text-xs font-medium">{reply.trashCount || ''}</span>
                                    </button>
                                </div>
                            </div>
                        </article>

                        {replyingToId === reply.id && currentUser && (
                            <div className="border-b border-border/30 bg-bg-secondary/30 px-4 py-3 pb-4">
                                <form onSubmit={(event) => onNestedReplySubmit(event, reply.id)} className="flex gap-3" style={{ marginLeft: `${getIndent(reply.depth + 1)}px` }}>
                                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-bg-hover">
                                        <img src={getAvatarUrl(currentUser.username, currentUser.profilePic)} alt="" className="h-full w-full object-cover" />
                                    </div>
                                    <div className="flex-1">
                                        <MentionTextarea
                                            ref={nestedReplyTextareaRef}
                                            value={nestedReplyContent}
                                            onValueChange={onNestedReplyChange}
                                            placeholder="Yanıtla..."
                                            autoFocus
                                            containerClassName="w-full"
                                            className="w-full resize-none bg-transparent pt-1 text-[15px] text-text-primary placeholder:text-text-muted outline-none"
                                            rows={2}
                                        />
                                        <div className="mt-2 flex justify-end">
                                            <button
                                                type="submit"
                                                disabled={!nestedReplyContent.trim() || isSubmittingNested}
                                                className="flex items-center gap-2 rounded-full bg-text-primary px-4 py-1.5 text-xs font-semibold text-inverse-primary transition-colors hover:bg-bg-secondary disabled:opacity-50"
                                            >
                                                {isSubmittingNested && <Loader2 size={12} className="animate-spin" />}
                                                Yanıtla
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        )}
                    </div>
                </React.Fragment>
            ))}
        </>
    );
}
