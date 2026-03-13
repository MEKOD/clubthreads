import { toAbsoluteUrl } from './axios';

interface ShareCardOptions {
    title?: string;
    text?: string;
}

function downloadBlob(blob: Blob, filename: string) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

export async function sharePostCard(postId: string, options: ShareCardOptions = {}) {
    const shareImageUrl = toAbsoluteUrl(`/share/${postId}`);
    if (!shareImageUrl) {
        throw new Error('Share card URL could not be resolved');
    }

    let pngBlob: Blob;
    try {
        const response = await fetch(shareImageUrl);
        if (!response.ok) {
            throw new Error(`Share card fetch failed (${response.status})`);
        }

        const blob = await response.blob();
        pngBlob = blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' });
    } catch {
        window.open(shareImageUrl, '_blank', 'noopener,noreferrer');
        throw new Error('Share card fetch failed');
    }

    const file = new File([pngBlob], `club-threads-${postId}.png`, { type: 'image/png' });
    const title = options.title ?? 'Club Threads';
    const text = options.text ?? '';

    if (navigator.share) {
        try {
            await navigator.share({ files: [file], title, text });
            return;
        } catch (error) {
            const maybeAbort = (error as Error).name === 'AbortError';
            if (maybeAbort) {
                return;
            }
        }
    }

    if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'image/png': pngBlob,
                }),
            ]);
            return;
        } catch {
            // Fall back to file download if clipboard image write is unavailable.
        }
    }

    downloadBlob(pngBlob, file.name);
}
