import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createTimelineNavigationState, withViewTransition } from '../../lib/navigation';

interface ThreadAncestorPost {
    id: string;
    parentId: string | null;
    content: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    authorUsername: string;
    authorProfilePic: string | null;
}

export function ThreadContext({ ancestors }: { ancestors: ThreadAncestorPost[] }) {
    const location = useLocation();
    const navigate = useNavigate();
    const buildDetailState = () => createTimelineNavigationState(location, { scrollY: window.scrollY });

    if (ancestors.length === 0) {
        return null;
    }

    return (
        <div className="border-b border-border-subtle bg-bg-secondary/35 px-4 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                Thread context
            </div>
            <div className="space-y-2">
                {ancestors.map((ancestor, index) => (
                    <Link
                        key={ancestor.id}
                        to={`/post/${ancestor.id}`}
                        onClick={(event) => {
                            event.preventDefault();
                            navigate(`/post/${ancestor.id}`, withViewTransition({ state: buildDetailState() }));
                        }}
                        className="block rounded-2xl border border-border-subtle bg-bg-primary/85 px-3 py-2.5 transition hover:bg-bg-hover"
                    >
                        <div className="text-xs font-semibold text-text-primary">
                            @{ancestor.authorUsername}
                            {index === ancestors.length - 1 && (
                                <span className="ml-2 font-medium text-text-secondary">yanıtlanan post</span>
                            )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-text-secondary">
                            {ancestor.content || 'Medyali post'}
                        </p>
                    </Link>
                ))}
            </div>
        </div>
    );
}
