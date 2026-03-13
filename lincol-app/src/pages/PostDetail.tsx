import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart2, Heart, MessageCircle, Repeat2, Share2, Trash2, Loader2, X, SmilePlus } from 'lucide-react';
import { format } from 'date-fns';
import { getAvatarUrl } from '../lib/axios';
import { VerifiedBadge } from '../components/ui/VerifiedBadge';
import { DeferredGifPicker } from '../components/ui/DeferredGifPicker';
import { PostMedia } from '../components/ui/MediaLightbox';
import { renderContentWithMentions } from '../lib/mentions';
import { PollView } from '../components/feed/PollView';
import { RepostComposerSheet } from '../components/feed/RepostComposerSheet';
import { ThreadContext } from '../components/post-detail/ThreadContext';
import { ThreadReplyList } from '../components/post-detail/ThreadReplyList';
import { usePostDetailController } from '../hooks/usePostDetailController';
import { LinkPreviewCard } from '../components/ui/LinkPreviewCard';
import { PostOverflowMenu } from '../components/feed/PostOverflowMenu';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { MentionTextarea } from '../components/ui/MentionTextarea';

function formatMetricCount(value?: number) {
    return new Intl.NumberFormat('tr-TR').format(Math.max(0, value ?? 0));
}

export function PostDetail() {
    const {
        currentUser,
        post,
        replies,
        threadReplies,
        loading,
        replyContent,
        setReplyContent,
        replyGif,
        setReplyGif,
        isGifPickerOpen,
        setIsGifPickerOpen,
        isReplying,
        replyError,
        clearReplyError,
        replyingToId,
        setReplyingToId,
        nestedReplyContent,
        setNestedReplyContent,
        isSubmittingNested,
        isReposting,
        parentPost,
        replyAncestors,
        quoteText,
        setQuoteText,
        quoteGif,
        setQuoteGif,
        isQuoteGifPickerOpen,
        setIsQuoteGifPickerOpen,
        showRepostDialog,
        repostTarget,
        canSubmitReply,
        mediaUrl,
        isVideo,
        posterUrl,
        parentMediaUrl,
        parentIsVideo,
        parentPosterUrl,
        goBack,
        nestedReplyTextareaRef,
        handleReply,
        handleNestedReply,
        handleMainPostInteraction,
        handleReplyInteraction,
        handleShare,
        handleRepost,
        closeRepostDialog,
        submitRepost,
    } = usePostDetailController();

    useBodyScrollLock(showRepostDialog);

    if (loading) {
        return <div className="min-h-screen flex justify-center pt-20"><Loader2 className="w-8 h-8 animate-spin text-text-primary" /></div>;
    }

    if (!post) {
        return <div className="p-8 text-center bg-bg-primary min-h-screen">Post bulunamadı.</div>;
    }

    return (
        <div className="min-h-screen bg-bg-primary text-text-primary pb-20 md:pb-0">
            <RepostComposerSheet
                open={showRepostDialog}
                target={repostTarget}
                quoteText={quoteText}
                onQuoteTextChange={setQuoteText}
                quoteGif={quoteGif}
                onQuoteGifChange={setQuoteGif}
                gifPickerOpen={isQuoteGifPickerOpen}
                onGifPickerOpenChange={setIsQuoteGifPickerOpen}
                isSubmitting={isReposting}
                onClose={closeRepostDialog}
                onSubmit={submitRepost}
            />

            <header className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))] z-30 flex items-center gap-6 border-b border-border-subtle bg-bg-primary/80 px-4 py-3 backdrop-blur-md md:top-0">
                <button onClick={goBack} className="p-2 -ml-2 hover:bg-bg-secondary rounded-full transition-colors">
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-xl font-bold tracking-tight">Post</h1>
            </header>

            <ThreadContext ancestors={replyAncestors} />

            <article className="p-4 border-b border-border-subtle">
                <div className="flex gap-3 mb-3">
                    <Link to={`/users/${post.authorUsername}`} viewTransition className="flex-shrink-0">
                        <div className="w-12 h-12 rounded-full overflow-hidden bg-bg-hover">
                            <img
                                src={getAvatarUrl(post.authorUsername, post.authorProfilePic)}
                                alt={post.authorUsername}
                                className="w-full h-full object-cover"
                            />
                        </div>
                    </Link>

                    <div className="flex-1 flex items-start justify-between gap-3">
                        <div className="flex flex-col justify-center">
                            <Link to={`/users/${post.authorUsername}`} viewTransition className="flex items-center gap-1 font-bold text-text-primary hover:underline">
                                {post.authorUsername}
                                <VerifiedBadge role={post.authorRole} size={18} />
                            </Link>
                            <span className="text-text-secondary text-[15px]">@{post.authorUsername}</span>
                        </div>
                        <PostOverflowMenu
                            postId={post.id}
                            authorUsername={post.authorUsername}
                            content={post.content}
                            isOwner={currentUser?.username === post.authorUsername}
                            onDeleted={goBack}
                            onBlocked={goBack}
                            onHidden={goBack}
                        />
                    </div>
                </div>

                {post.content && (
                    <p className="mb-4 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xl leading-relaxed tracking-tight text-text-primary">
                        {renderContentWithMentions(post.content)}
                    </p>
                )}

                {post.linkPreview && (
                    <div className="mb-4">
                        <LinkPreviewCard preview={post.linkPreview} />
                    </div>
                )}

                {post.type === 'rt' && parentPost && (
                    <Link
                        to={`/post/${parentPost.id}`}
                        viewTransition
                        className="mb-4 block overflow-hidden rounded-2xl border border-border/80 bg-bg-secondary p-4 transition hover:bg-bg-secondary"
                    >
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                            <Repeat2 size={14} />
                            Yeniden paylasilan post
                        </div>
                        <div className="text-sm font-semibold text-text-primary">@{parentPost.authorUsername}</div>
                        {parentPost.content ? (
                            <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-text-primary">{parentPost.content}</p>
                        ) : (
                            <p className="mt-1 text-sm text-text-secondary">Medyali postu ac</p>
                        )}
                        {parentMediaUrl && (
                            <div className="mt-3 overflow-hidden rounded-2xl border border-border-subtle bg-text-primary">
                                {parentIsVideo ? (
                                    <video src={parentMediaUrl} poster={parentPosterUrl ?? undefined} controls className="max-h-[22rem] w-full bg-black" />
                                ) : (
                                    <img src={parentMediaUrl} alt="Orijinal medya" className="max-h-[22rem] w-full object-cover" />
                                )}
                            </div>
                        )}
                    </Link>
                )}

                {post.type === 'quote' && parentPost && (
                    <Link
                        to={`/post/${parentPost.id}`}
                        viewTransition
                        className="mb-4 block overflow-hidden rounded-2xl border border-border/80 bg-bg-secondary p-4 transition hover:bg-bg-secondary"
                    >
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Alintilanan post</div>
                        <div className="text-sm font-semibold text-text-primary">@{parentPost.authorUsername}</div>
                        {parentPost.content ? (
                            <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-text-primary">{parentPost.content}</p>
                        ) : (
                            <p className="mt-1 text-sm text-text-secondary">Medyali postu ac</p>
                        )}
                        {parentMediaUrl && (
                            <div className="mt-3 overflow-hidden rounded-2xl border border-border-subtle bg-text-primary">
                                {parentIsVideo ? (
                                    <video src={parentMediaUrl} poster={parentPosterUrl ?? undefined} controls className="max-h-[22rem] w-full bg-black" />
                                ) : (
                                    <img src={parentMediaUrl} alt="Orijinal medya" className="max-h-[22rem] w-full object-cover" />
                                )}
                            </div>
                        )}
                    </Link>
                )}

                {mediaUrl && (
                    <div className="mb-4">
                        <PostMedia src={mediaUrl} posterSrc={posterUrl ?? undefined} isVideo={!!isVideo} alt="Post medya" />
                    </div>
                )}

                {post.poll && (
                    <div className="mb-4">
                        <PollView poll={post.poll} />
                    </div>
                )}

                <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border/30 pb-4 text-[15px] text-text-secondary">
                    <span>{format(new Date(post.createdAt), 'h:mm a · MMM d, yyyy')}</span>
                    <span className="text-text-muted">·</span>
                    <span className="inline-flex items-center gap-1.5 font-medium">
                        <BarChart2 size={16} />
                        {formatMetricCount(post.viewCount)} goruntulenme
                    </span>
                </div>

                <div className="flex items-center justify-around text-text-secondary pb-2">
                    <button className="flex items-center gap-1.5 group hover:text-text-primary transition-colors">
                        <div className="p-2 rounded-full group-hover:bg-bg-hover"><MessageCircle size={20} strokeWidth={2} /></div>
                        <span className="font-medium">{post.replyCount || ''}</span>
                    </button>

                    <button onClick={() => handleMainPostInteraction('fav')} className={`flex items-center gap-1.5 group transition-colors ${post.hasFav ? 'text-[#d14b3b]' : 'hover:text-[#d14b3b]'}`}>
                        <div className="p-2 rounded-full group-hover:bg-[#ffe5df]"><Heart size={20} strokeWidth={2} fill={post.hasFav ? 'currentColor' : 'none'} /></div>
                        <span className="font-medium">{post.favCount || ''}</span>
                    </button>

                    <button onClick={() => handleMainPostInteraction('trash')} className={`flex items-center gap-1.5 group transition-colors ${post.hasTrash ? 'text-red-500' : 'hover:text-red-500'}`}>
                        <div className="p-2 rounded-full group-hover:bg-red-50"><Trash2 size={20} strokeWidth={2} fill={post.hasTrash ? 'currentColor' : 'none'} /></div>
                        <span className="font-medium">{post.trashCount || ''}</span>
                    </button>

                    <button
                        onClick={() => handleRepost()}
                        disabled={isReposting}
                        className="flex items-center gap-1.5 group transition-colors disabled:opacity-50 hover:text-text-primary"
                    >
                        <div className="p-2 rounded-full group-hover:bg-[#eef7cb]"><Repeat2 size={20} strokeWidth={2} /></div>
                        <span className="font-medium">{post.rtCount || ''}</span>
                    </button>

                    <button onClick={handleShare} className="flex items-center gap-1.5 group hover:text-text-primary transition-colors">
                        <div className="p-2 rounded-full group-hover:bg-bg-hover"><Share2 size={20} strokeWidth={2} /></div>
                    </button>
                </div>
            </article>

            {currentUser && (
                <form onSubmit={handleReply} className="flex gap-3 p-4 border-b border-border-subtle items-start">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-bg-hover flex-shrink-0">
                        <img src={getAvatarUrl(currentUser.username, currentUser.profilePic)} alt={currentUser.username} className="w-full h-full object-cover" />
                    </div>

                    <div className="flex-1">
                        <MentionTextarea
                            value={replyContent}
                            onValueChange={(nextValue) => {
                                setReplyContent(nextValue);
                                if (replyError) {
                                    clearReplyError();
                                }
                            }}
                            placeholder="Yanıtını gönder..."
                            containerClassName="w-full"
                            className="w-full bg-transparent text-text-primary text-[17px] placeholder:text-text-muted outline-none resize-none pt-2"
                            rows={2}
                        />

                        {replyGif && (
                            <div className="relative mt-2 inline-block">
                                <img src={replyGif} alt="Selected GIF" className="max-h-48 rounded-2xl object-cover border border-border-subtle" />
                                <button
                                    type="button"
                                    onClick={() => setReplyGif(null)}
                                    className="absolute right-2 top-2 rounded-full bg-overlay-dark p-1.5 text-inverse-primary"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        )}

                        <div className="flex justify-between mt-2 border-t border-border/30 pt-3">
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setIsGifPickerOpen(true)}
                                    disabled={replyGif !== null}
                                    className="p-2 text-text-secondary hover:bg-bg-hover hover:text-text-primary rounded-full transition-colors disabled:opacity-50"
                                >
                                    <SmilePlus size={20} strokeWidth={2} />
                                </button>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <button
                                    type="submit"
                                    disabled={!canSubmitReply}
                                    className="bg-text-primary text-inverse-primary px-5 py-1.5 rounded-full font-medium text-sm hover:bg-bg-secondary disabled:opacity-50 transition-colors flex items-center gap-2"
                                >
                                    {isReplying && <Loader2 size={14} className="animate-spin" />}
                                    {isReplying ? 'Gonderiliyor...' : 'Yanıtla'}
                                </button>
                                {replyError && (
                                    <p className="text-xs text-[#b14d2e]">
                                        {replyError}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </form>
            )}

            <div className="divide-y divide-[#E5E5E5]/30">
                <ThreadReplyList
                    replies={threadReplies}
                    contextPool={[...replies, post, ...replyAncestors]}
                    currentUser={currentUser}
                    replyingToId={replyingToId}
                    nestedReplyContent={nestedReplyContent}
                    isSubmittingNested={isSubmittingNested}
                    nestedReplyTextareaRef={nestedReplyTextareaRef}
                    onReplyInteract={handleReplyInteraction}
                    onReplyRepost={(replyId) => {
                        const reply = replies.find((item) => item.id === replyId);
                        if (!reply) return;
                        handleRepost({
                            id: reply.id,
                            content: reply.content,
                            authorUsername: reply.authorUsername,
                            authorProfilePic: reply.authorProfilePic,
                            mediaUrl: reply.mediaUrl ?? null,
                            mediaMimeType: reply.mediaMimeType ?? null,
                            rtCount: reply.rtCount ?? 0,
                        });
                    }}
                    onStartReply={(replyId, username) => {
                        setReplyingToId(replyId);
                        setNestedReplyContent(`@${username} `);
                    }}
                    onNestedReplyChange={setNestedReplyContent}
                    onNestedReplySubmit={handleNestedReply}
                />
            </div>

            {isGifPickerOpen && (
                <DeferredGifPicker
                    onClose={() => setIsGifPickerOpen(false)}
                    onSelect={(url: string) => {
                        setReplyGif(url);
                        setIsGifPickerOpen(false);
                    }}
                />
            )}
        </div>
    );
}
