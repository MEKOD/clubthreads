import type { TimelinePost } from '../../lib/social';
import { PostCard } from '../feed/PostCard';

interface CommunityFeedTabProps {
    posts: TimelinePost[];
    emptyLabel: string;
    onInteract?: (postId: string, type: 'fav' | 'trash') => void;
    onRepost?: (postId: string) => void;
    onShare?: (postId: string) => void;
}

export function CommunityFeedTab({ posts, emptyLabel, onInteract, onRepost, onShare }: CommunityFeedTabProps) {
    if (posts.length === 0) {
        return (
            <div className="rounded-[24px] border border-black/[0.06] bg-bg-primary/90 px-5 py-12 text-center text-sm text-text-secondary shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                {emptyLabel}
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-[26px] border border-black/[0.06] bg-bg-primary/95 shadow-[0_18px_60px_rgba(17,17,17,0.05)]">
            {posts.map((post) => (
                <PostCard
                    key={post.id}
                    post={post}
                    onInteract={onInteract}
                    onRepost={onRepost}
                    onShare={onShare}
                />
            ))}
        </div>
    );
}
