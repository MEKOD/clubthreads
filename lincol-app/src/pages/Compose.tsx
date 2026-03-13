import { X } from 'lucide-react';
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { QuickComposer } from '../components/feed/QuickComposer';

export function Compose() {
    const navigate = useNavigate();
    const location = useLocation();

    const navState = (location.state ?? {}) as {
        returnTo?: string;
        scrollY?: number;
    };
    const returnTo = navState.returnTo || '/';

    const sharedContent = useMemo(() => {
        const params = new URLSearchParams(location.search);
        const title = params.get('title')?.trim();
        const text = params.get('text')?.trim();
        const url = params.get('url')?.trim();
        return [title, text, url].filter(Boolean).join('\n\n');
    }, [location.search]);


    const goBack = (postedPreview?: {
        id: string;
        content: string | null;
        mediaUrl: string | null;
        mediaMimeType: string | null;
    }) => {
        navigate(returnTo, {
            replace: true,
            state: {
                composePostedPreview: postedPreview ?? null,
                composePostedAt: postedPreview ? Date.now() : null,
                scrollY: navState.scrollY ?? 0,
            },
            viewTransition: true,
        });
    };

    return (
        <div className="mx-auto min-h-[var(--viewport-height)] max-w-[760px] px-0 md:px-4 md:py-5">
            <div className="min-h-[var(--viewport-height)] overflow-hidden bg-bg-primary md:min-h-0 md:rounded-[24px] md:border md:border-border-subtle md:shadow-[0_24px_70px_rgba(15,20,25,0.08)]">
                <header className="flex items-center justify-between border-b border-border-subtle bg-bg-primary/92 px-4 py-3 backdrop-blur-xl">
                    <button
                        type="button"
                        onClick={() => goBack()}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-text-primary transition hover:bg-bg-secondary"
                    >
                        <X size={22} />
                    </button>
                    <div className="text-[15px] font-semibold text-text-primary">Yeni post</div>
                    <div className="w-10" />
                </header>

                <div className="h-[calc(var(--viewport-height)-57px)] px-0 md:h-[min(42rem,calc(var(--viewport-height)-6rem))]">
                    <QuickComposer autoFocus initialContent={sharedContent} onPosted={(post) => goBack(post)} />
                </div>
            </div>
        </div>
    );
}
