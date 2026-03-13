import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, toAbsoluteUrl, toVideoPosterUrl } from '../lib/axios';
import { applyInteractionSnapshot, hasFreshInteractionSnapshot, setInteractionSnapshot } from '../lib/interactionCache';
import type { TimelineNavigationState } from '../lib/navigation';
import { withViewTransition } from '../lib/navigation';
import type { LinkPreview } from '../lib/social';
import { useAuthStore } from '../store/authStore';
import type { PollData } from '../components/feed/PollView';
import { trackAnalyticsEvent } from '../lib/analytics';

interface DetailPost {
    id: string;
    content: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    type: 'post' | 'rt' | 'quote';
    parentId: string | null;
    favCount: number;
    trashCount: number;
    replyCount: number;
    rtCount: number;
    viewCount?: number;
    createdAt: string;
    authorId?: string;
    authorUsername: string;
    authorProfilePic: string | null;
    authorRole?: 'user' | 'elite' | 'admin';
    hasFav?: boolean;
    hasTrash?: boolean;
    linkPreview?: LinkPreview | null;
    poll?: PollData;
}

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
}

interface ParentPreviewPost {
    id: string;
    content: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    authorUsername: string;
    authorProfilePic: string | null;
    linkPreview?: LinkPreview | null;
}

interface ThreadAncestorPost extends ParentPreviewPost {
    parentId: string | null;
}

interface FlatReplyNode extends ReplyPost {
    depth: number;
}

type RepostTarget = {
    id: string;
    content: string | null;
    authorUsername: string;
    authorProfilePic?: string | null;
    mediaUrl?: string | null;
    mediaMimeType?: string | null;
    parentPreview?: ParentPreviewPost | null;
    rtCount: number;
};

export function usePostDetailController() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const currentUser = useAuthStore((state) => state.user);

    const [post, setPost] = useState<DetailPost | null>(null);
    const [replies, setReplies] = useState<ReplyPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [replyContent, setReplyContent] = useState('');
    const [replyGif, setReplyGif] = useState<string | null>(null);
    const [isGifPickerOpen, setIsGifPickerOpen] = useState(false);
    const [isReplying, setIsReplying] = useState(false);
    const [replyError, setReplyError] = useState<string | null>(null);
    const [replyingToId, setReplyingToId] = useState<string | null>(null);
    const [nestedReplyContent, setNestedReplyContent] = useState('');
    const [isSubmittingNested, setIsSubmittingNested] = useState(false);
    const [isSubmittingRepost, setIsSubmittingRepost] = useState(false);
    const [parentPost, setParentPost] = useState<ParentPreviewPost | null>(null);
    const [replyAncestors, setReplyAncestors] = useState<ThreadAncestorPost[]>([]);
    const [quoteText, setQuoteText] = useState('');
    const [quoteGif, setQuoteGif] = useState<string | null>(null);
    const [isQuoteGifPickerOpen, setIsQuoteGifPickerOpen] = useState(false);
    const [showRepostDialog, setShowRepostDialog] = useState(false);
    const [repostTarget, setRepostTarget] = useState<RepostTarget | null>(null);

    const lastMutationAtRef = useRef(0);
    const nestedReplyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const lastTrackedPostOpenRef = useRef<string | null>(null);

    const timelineState = location.state as TimelineNavigationState | null;
    const canSubmitReply = (replyContent.trim().length > 0 || replyGif !== null) && !isReplying;
    const mediaUrl = toAbsoluteUrl(post?.mediaUrl);
    const isVideo = post?.mediaMimeType?.startsWith('video/');
    const posterUrl = isVideo ? toVideoPosterUrl(post?.mediaUrl) : null;
    const parentMediaUrl = toAbsoluteUrl(parentPost?.mediaUrl);
    const parentIsVideo = parentPost?.mediaMimeType?.startsWith('video/');
    const parentPosterUrl = parentIsVideo ? toVideoPosterUrl(parentPost?.mediaUrl) : null;

    const goBack = () => {
        const from = timelineState?.from;
        if (from) {
            navigate(from, withViewTransition({
                replace: true,
                state: { scrollY: timelineState.scrollY ?? 0 },
            }));
            return;
        }
        navigate(-1);
    };

    const flattenReplies = useCallback((items: ReplyPost[], rootId: string) => {
        const byParent = new Map<string, ReplyPost[]>();
        for (const item of items) {
            const parentKey = item.parentId ?? rootId;
            const bucket = byParent.get(parentKey);
            if (bucket) bucket.push(item);
            else byParent.set(parentKey, [item]);
        }

        const ordered: FlatReplyNode[] = [];
        const visit = (parentId: string, depth: number) => {
            const children = [...(byParent.get(parentId) ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            for (const child of children) {
                ordered.push({ ...child, depth });
                visit(child.id, depth + 1);
            }
        };

        visit(rootId, 0);
        return ordered;
    }, []);

    const threadReplies = useMemo(
        () => (post ? flattenReplies(replies, post.id) : []),
        [flattenReplies, post, replies]
    );

    useEffect(() => {
        if (!id) return;
        setLoading(true);
        window.scrollTo({ top: 0, behavior: 'auto' });
    }, [id]);

    const fetchPost = useCallback(async () => {
        if (!id) return;
        if (Date.now() - lastMutationAtRef.current < 4000) return;

        try {
            const response = await api.get(`/posts/${id}`);
            const {
                post: fetchedPost,
                replies: fetchedReplies,
                ancestors: fetchedAncestors,
                parentPost: fetchedParentPost,
            } = response.data as {
                post: DetailPost;
                replies: ReplyPost[];
                ancestors?: ThreadAncestorPost[];
                parentPost?: ParentPreviewPost | null;
            };
            setPost(applyInteractionSnapshot(fetchedPost));
            setReplies((fetchedReplies ?? []).map(applyInteractionSnapshot));
            setParentPost(fetchedParentPost ?? null);
            setReplyAncestors(fetchedAncestors ?? []);

            try {
                const interactionResponse = await api.get(`/posts/${id}/interactions`);
                setPost((current) => {
                    if (!current) return current;
                    if (hasFreshInteractionSnapshot(current.id)) return applyInteractionSnapshot(current);
                    const nextPost = {
                        ...current,
                        favCount: interactionResponse.data.favCount ?? current.favCount,
                        trashCount: interactionResponse.data.trashCount ?? current.trashCount,
                        hasFav: interactionResponse.data.myInteraction === 'FAV',
                        hasTrash: interactionResponse.data.myInteraction === 'TRASH',
                    };
                    setInteractionSnapshot(current.id, {
                        favCount: nextPost.favCount,
                        trashCount: nextPost.trashCount,
                        hasFav: nextPost.hasFav ?? false,
                        hasTrash: nextPost.hasTrash ?? false,
                    });
                    return nextPost;
                });
            } catch {
                // ignore
            }
        } catch (error) {
            console.error('Failed to fetch post', error);
        } finally {
            setLoading(false);
        }
    }, [id]);

    const applyInteraction = <T extends { favCount: number; trashCount: number; hasFav?: boolean; hasTrash?: boolean }>(
        target: T,
        type: 'fav' | 'trash'
    ): T => {
        let favCount = target.favCount;
        let trashCount = target.trashCount;
        let hasFav = target.hasFav ?? false;
        let hasTrash = target.hasTrash ?? false;
        if (type === 'fav') {
            if (hasFav) {
                favCount -= 1;
                hasFav = false;
            } else {
                favCount += 1;
                hasFav = true;
                if (hasTrash) {
                    trashCount -= 1;
                    hasTrash = false;
                }
            }
        } else if (hasTrash) {
            trashCount -= 1;
            hasTrash = false;
        } else {
            trashCount += 1;
            hasTrash = true;
            if (hasFav) {
                favCount -= 1;
                hasFav = false;
            }
        }
        return { ...target, favCount, trashCount, hasFav, hasTrash };
    };

    useEffect(() => {
        void fetchPost();
    }, [fetchPost, id]);

    useEffect(() => {
        if (!id) {
            return;
        }

        if (lastTrackedPostOpenRef.current === id) {
            return;
        }

        lastTrackedPostOpenRef.current = id;
        trackAnalyticsEvent({
            eventType: 'post_open',
            surface: 'post_detail',
            entityType: 'post',
            entityId: id,
        });
    }, [id]);

    useEffect(() => {
        const onFocus = () => {
            if (document.visibilityState !== 'visible') return;
            void fetchPost();
        };
        const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') void fetchPost();
        }, 30_000);
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, [fetchPost, id]);

    useEffect(() => {
        if (!replyingToId || !nestedReplyContent.startsWith('@')) return;
        const textarea = nestedReplyTextareaRef.current;
        if (!textarea) return;
        const caretPosition = nestedReplyContent.length;
        requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(caretPosition, caretPosition);
        });
    }, [nestedReplyContent, replyingToId]);

    const handleReply = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!id || (!replyContent.trim() && !replyGif)) return;
        setIsReplying(true);
        setReplyError(null);
        try {
            lastMutationAtRef.current = Date.now();
            const response = await api.post('/posts', {
                type: 'post',
                content: replyContent.trim() || undefined,
                mediaUrl: replyGif || undefined,
                mediaMimeType: replyGif ? 'image/gif' : undefined,
                parentId: id,
            });
            setReplies((current) => [
                {
                    ...response.data.post,
                    parentId: id,
                    authorUsername: currentUser?.username || 'you',
                    authorProfilePic: currentUser?.profilePic || null,
                    authorRole: currentUser?.role || 'user',
                    hasFav: false,
                    hasTrash: false,
                    replyCount: 0,
                    rtCount: 0,
                },
                ...current,
            ]);
            trackAnalyticsEvent({
                eventType: 'post_reply_submit',
                surface: 'post_detail',
                entityType: 'post',
                entityId: id,
            });
            setReplyContent('');
            setReplyGif(null);
            setPost((current) => current ? { ...current, replyCount: current.replyCount + 1 } : current);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                setReplyError(error.response?.data?.error || error.response?.data?.message || 'Yorum gönderilemedi. Birazdan tekrar dene.');
            } else {
                setReplyError('Yorum gönderilemedi. Birazdan tekrar dene.');
            }
            console.error('Reply failed', error);
        } finally {
            setIsReplying(false);
        }
    };

    const handleNestedReply = async (event: React.FormEvent<HTMLFormElement>, parentReplyId: string) => {
        event.preventDefault();
        if (!nestedReplyContent.trim()) return;
        setIsSubmittingNested(true);
        try {
            lastMutationAtRef.current = Date.now();
            const response = await api.post('/posts', {
                type: 'post',
                content: nestedReplyContent.trim(),
                parentId: parentReplyId,
            });
            trackAnalyticsEvent({
                eventType: 'post_reply_submit',
                surface: 'post_detail_nested',
                entityType: 'post',
                entityId: parentReplyId,
            });
            setReplies((current) => [...current, {
                ...response.data.post,
                parentId: parentReplyId,
                authorUsername: currentUser?.username || 'you',
                authorProfilePic: currentUser?.profilePic || null,
                authorRole: currentUser?.role || 'user',
                hasFav: false,
                hasTrash: false,
                replyCount: 0,
                rtCount: 0,
            }]);
            setReplies((current) => current.map((reply) => (
                reply.id === parentReplyId ? { ...reply, replyCount: (reply.replyCount ?? 0) + 1 } : reply
            )));
            setNestedReplyContent('');
            setReplyingToId(null);
        } catch (error) {
            console.error('Nested reply failed', error);
            alert('Yorum gönderilemedi. Birazdan tekrar dene.');
        } finally {
            setIsSubmittingNested(false);
        }
    };

    const handleMainPostInteraction = async (type: 'fav' | 'trash') => {
        if (!post) return;
        const previousPost = post;
        const nextPost = applyInteraction(post, type);
        setPost(nextPost);
        setInteractionSnapshot(post.id, {
            favCount: nextPost.favCount,
            trashCount: nextPost.trashCount,
            hasFav: nextPost.hasFav ?? false,
            hasTrash: nextPost.hasTrash ?? false,
        });
        try {
            lastMutationAtRef.current = Date.now();
            await api.post(`/posts/${post.id}/interact`, { type: type === 'fav' ? 'FAV' : 'TRASH' });
            trackAnalyticsEvent({
                eventType: type === 'fav' ? 'post_like' : 'post_trash',
                surface: 'post_detail',
                entityType: 'post',
                entityId: post.id,
            });
        } catch (error) {
            console.error('Interaction failed', error);
            setPost(previousPost);
        }
    };

    const handleReplyInteraction = async (replyId: string, type: 'fav' | 'trash') => {
        const previousReplies = replies;
        const previousReply = previousReplies.find((r) => r.id === replyId);
        if (!previousReply) return;
        const nextReply = applyInteraction(previousReply, type);
        setReplies((current) => current.map((reply) => (reply.id === replyId ? nextReply : reply)));
        setInteractionSnapshot(replyId, {
            favCount: nextReply.favCount,
            trashCount: nextReply.trashCount,
            hasFav: nextReply.hasFav ?? false,
            hasTrash: nextReply.hasTrash ?? false,
        });
        try {
            lastMutationAtRef.current = Date.now();
            await api.post(`/posts/${replyId}/interact`, { type: type === 'fav' ? 'FAV' : 'TRASH' });
            trackAnalyticsEvent({
                eventType: type === 'fav' ? 'post_like' : 'post_trash',
                surface: 'post_detail_reply',
                entityType: 'post',
                entityId: replyId,
            });
        } catch (error) {
            console.error('Interaction failed', error);
            setReplies(previousReplies);
        }
    };

    const handleShare = async () => {
        if (!post) return;
        const shareUrl = `${window.location.origin}/post/${post.id}`;
        try {
            trackAnalyticsEvent({
                eventType: 'post_share',
                surface: 'post_detail',
                entityType: 'post',
                entityId: post.id,
            });
            if (navigator.share) {
                await navigator.share({ title: 'Club Threads', text: post.content || 'Buna bak.', url: shareUrl });
                return;
            }
            await navigator.clipboard.writeText(shareUrl);
        } catch (error) {
            console.error('Share failed', error);
        }
    };

    const handleRepost = (target?: RepostTarget) => {
        const nextTarget = target ?? (post ? {
            id: post.id,
            content: post.content,
            authorUsername: post.authorUsername,
            authorProfilePic: post.authorProfilePic,
            mediaUrl: post.mediaUrl,
            mediaMimeType: post.mediaMimeType,
            parentPreview: parentPost,
            rtCount: post.rtCount,
        } : null);
        if (!nextTarget || isSubmittingRepost) return;
        trackAnalyticsEvent({
            eventType: 'post_repost',
            surface: 'post_detail',
            entityType: 'post',
            entityId: nextTarget.id,
        });
        setRepostTarget(nextTarget);
        setQuoteText('');
        setQuoteGif(null);
        setIsQuoteGifPickerOpen(false);
        setShowRepostDialog(true);
    };

    const closeRepostDialog = () => {
        setShowRepostDialog(false);
        setRepostTarget(null);
        setQuoteText('');
        setQuoteGif(null);
        setIsQuoteGifPickerOpen(false);
    };

    const submitRepost = async () => {
        if (!repostTarget || isSubmittingRepost) return;
        const previousPost = post;
        const previousReplies = replies;
        setIsSubmittingRepost(true);
        if (post?.id === repostTarget.id) {
            setPost({ ...post, rtCount: post.rtCount + 1 });
        } else {
            setReplies((current) => current.map((reply) => (
                reply.id === repostTarget.id
                    ? { ...reply, rtCount: (reply.rtCount ?? 0) + 1 }
                    : reply
            )));
        }
        try {
            lastMutationAtRef.current = Date.now();
            await api.post('/posts', {
                type: (quoteText.trim() || quoteGif) ? 'quote' : 'rt',
                parentId: repostTarget.id,
                content: quoteText.trim() || undefined,
                mediaUrl: quoteGif || undefined,
                mediaMimeType: quoteGif ? 'image/gif' : undefined,
            });
            trackAnalyticsEvent({
                eventType: (quoteText.trim() || quoteGif) ? 'post_quote' : 'post_repost',
                surface: 'post_detail',
                entityType: 'post',
                entityId: repostTarget.id,
            });
            closeRepostDialog();
        } catch (error) {
            console.error('Repost failed', error);
            setPost(previousPost);
            setReplies(previousReplies);
        } finally {
            setIsSubmittingRepost(false);
        }
    };

    return {
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
        clearReplyError: () => setReplyError(null),
        replyingToId,
        setReplyingToId,
        nestedReplyContent,
        setNestedReplyContent,
        isSubmittingNested,
        isReposting: isSubmittingRepost,
        parentPost,
        replyAncestors,
        quoteText,
        setQuoteText,
        quoteGif,
        setQuoteGif,
        isQuoteGifPickerOpen,
        setIsQuoteGifPickerOpen,
        showRepostDialog,
        setShowRepostDialog,
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
        fetchPost,
    };
}
