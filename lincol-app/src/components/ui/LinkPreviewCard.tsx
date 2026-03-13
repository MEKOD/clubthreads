import type { LinkPreview } from '../../lib/social';
import { toAbsoluteUrl } from '../../lib/axios';

interface LinkPreviewCardProps {
    preview: LinkPreview;
    compact?: boolean;
}

export function LinkPreviewCard({ preview, compact = false }: LinkPreviewCardProps) {
    const imageUrl = toAbsoluteUrl(preview.imageUrl);

    return (
        <a
            href={preview.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(event) => event.stopPropagation()}
            className="mt-2 block overflow-hidden rounded-2xl border border-border-subtle bg-bg-secondary/40 transition hover:bg-bg-hover"
        >
            {imageUrl && (
                <div className={compact ? 'max-h-40 overflow-hidden' : 'max-h-56 overflow-hidden'}>
                    <img src={imageUrl} alt={preview.title} className="h-full w-full object-cover" />
                </div>
            )}

            <div className="p-3">
                <div className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                    {preview.siteName || new URL(preview.url).hostname.replace(/^www\./i, '')}
                </div>
                <div className="mt-1 line-clamp-2 text-[14px] font-bold leading-5 text-text-primary">
                    {preview.title}
                </div>
                {preview.description && (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-text-secondary">
                        {preview.description}
                    </p>
                )}
            </div>
        </a>
    );
}
