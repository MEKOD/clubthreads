import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, PencilLine, Repeat2, SmilePlus, X } from 'lucide-react';
import { DeferredGifPicker } from '../ui/DeferredGifPicker';
import { MentionTextarea } from '../ui/MentionTextarea';
import { getAvatarUrl, toAbsoluteUrl, toVideoPosterUrl } from '../../lib/axios';
import type { ParentPreview } from '../../lib/social';
import { useAuthStore } from '../../store/authStore';
import { useMobileKeyboardInset } from '../../hooks/useMobileKeyboardInset';

export interface RepostComposerTarget {
    id: string;
    content: string | null;
    authorUsername: string;
    authorProfilePic?: string | null;
    mediaUrl?: string | null;
    mediaMimeType?: string | null;
    parentPreview?: ParentPreview | null;
    rtCount?: number;
}

interface RepostComposerSheetProps {
    open: boolean;
    target: RepostComposerTarget | null;
    quoteText: string;
    onQuoteTextChange: (value: string) => void;
    quoteGif: string | null;
    onQuoteGifChange: (value: string | null) => void;
    gifPickerOpen: boolean;
    onGifPickerOpenChange: (open: boolean) => void;
    isSubmitting: boolean;
    onClose: () => void;
    onSubmit: () => void;
}

function resolvePreviewContent(target: RepostComposerTarget) {
    return target.content || target.parentPreview?.content || 'Medyali post';
}

function resolvePreviewMedia(target: RepostComposerTarget) {
    const mediaUrl = target.mediaUrl ?? target.parentPreview?.mediaUrl ?? null;
    const mediaMimeType = target.mediaMimeType ?? target.parentPreview?.mediaMimeType ?? null;

    return {
        url: toAbsoluteUrl(mediaUrl),
        isVideo: Boolean(mediaMimeType?.startsWith('video/')),
        posterUrl: mediaMimeType?.startsWith('video/') ? toVideoPosterUrl(mediaUrl) : null,
    };
}

export function RepostComposerSheet(props: RepostComposerSheetProps) {
    const {
        open,
        target,
        quoteText,
        onQuoteTextChange,
        quoteGif,
        onQuoteGifChange,
        gifPickerOpen,
        onGifPickerOpenChange,
        isSubmitting,
        onClose,
        onSubmit,
    } = props;
    const user = useAuthStore((state) => state.user);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [mode, setMode] = useState<'chooser' | 'quote'>('chooser');
    const keyboardInset = useMobileKeyboardInset(open && mode === 'quote');
    const hasQuote = quoteText.trim().length > 0 || Boolean(quoteGif);
    const charCount = quoteText.length;
    const guidelineLimit = 280;
    const guideDelta = guidelineLimit - charCount;

    const preview = useMemo(() => {
        if (!target) {
            return null;
        }

        return {
            avatarUrl: getAvatarUrl(target.authorUsername, target.authorProfilePic),
            content: resolvePreviewContent(target),
            ...resolvePreviewMedia(target),
        };
    }, [target]);

    useEffect(() => {
        if (!open) {
            setMode('chooser');
            return;
        }

        setMode(hasQuote ? 'quote' : 'chooser');
    }, [hasQuote, open, target?.id]);

    useEffect(() => {
        if (!open || mode !== 'quote') {
            return;
        }

        const frameId = window.requestAnimationFrame(() => textareaRef.current?.focus());
        return () => window.cancelAnimationFrame(frameId);
    }, [mode, open]);

    if (!open || !target || !preview) {
        return null;
    }

    const isQuoteMode = mode === 'quote';
    const canSubmitQuote = hasQuote && guideDelta >= 0 && !isSubmitting;
    const currentUserAvatar = getAvatarUrl(user?.username, user?.profilePic);

    return (
        <>
            <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(15,20,25,0.58)] backdrop-blur-sm md:items-center md:p-4" onClick={onClose}>
                {!isQuoteMode ? (
                    <div
                        onClick={(event) => event.stopPropagation()}
                        className="w-full rounded-t-[24px] border border-border-subtle bg-bg-primary p-2 shadow-[0_24px_70px_rgba(15,20,25,0.2)] md:w-[22rem] md:rounded-[20px]"
                    >
                        <button
                            type="button"
                            onClick={onSubmit}
                            disabled={isSubmitting}
                            className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[18px] font-semibold text-text-primary transition hover:bg-bg-secondary disabled:opacity-50"
                        >
                            {isSubmitting ? <Loader2 size={20} className="animate-spin" /> : <Repeat2 size={20} />}
                            Repost
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('quote')}
                            className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[18px] font-semibold text-text-primary transition hover:bg-bg-secondary"
                        >
                            <PencilLine size={20} />
                            Quote
                        </button>
                    </div>
                ) : (
                    <div
                        onClick={(event) => event.stopPropagation()}
                        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[24px] border border-border-subtle bg-bg-primary shadow-[0_30px_90px_rgba(15,20,25,0.24)] md:max-w-[38rem] md:rounded-[24px]"
                        style={keyboardInset > 0 ? { paddingBottom: `${keyboardInset}px` } : undefined}
                    >
                        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-text-primary transition hover:bg-bg-secondary"
                                aria-label="Kapat"
                            >
                                <X size={20} />
                            </button>

                            <button
                                type="button"
                                onClick={onSubmit}
                                disabled={!canSubmitQuote}
                                className="inline-flex h-9 min-w-[88px] items-center justify-center rounded-full bg-text-primary px-4 text-sm font-bold text-inverse-primary transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Quote'}
                            </button>
                        </div>

                        <div className="native-sheet-scroll flex-1 overflow-y-auto px-4 py-4">
                            <div className="flex items-start gap-3">
                                <div className="h-10 w-10 overflow-hidden rounded-full bg-bg-secondary">
                                    <img src={currentUserAvatar} alt={user?.username || 'you'} className="h-full w-full object-cover" />
                                </div>

                                <div className="min-w-0 flex-1">
                                    <button
                                        type="button"
                                        className="inline-flex h-8 items-center rounded-full border border-brand/20 bg-brand/5 px-3 text-[13px] font-semibold text-brand"
                                    >
                                        Herkes
                                    </button>

                                    <MentionTextarea
                                        ref={textareaRef}
                                        value={quoteText}
                                        onValueChange={onQuoteTextChange}
                                        placeholder="Bir yorum ekle"
                                        rows={4}
                                        containerClassName="mt-3 w-full"
                                        className="min-h-[96px] w-full resize-none border-0 bg-transparent p-0 text-[20px] leading-[1.4] text-text-primary outline-none placeholder:text-text-muted md:min-h-[120px] md:text-[24px]"
                                    />

                                    {quoteGif && (
                                        <div className="relative mt-3 overflow-hidden rounded-[20px] border border-border-subtle bg-bg-secondary">
                                            <img src={quoteGif} alt="Secilen GIF" className="max-h-56 w-full object-cover" />
                                            <button
                                                type="button"
                                                onClick={() => onQuoteGifChange(null)}
                                                className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-overlay-dark text-inverse-primary"
                                            >
                                                <X size={15} />
                                            </button>
                                        </div>
                                    )}

                                    <div className="mt-4 overflow-hidden rounded-[18px] border border-border-subtle bg-bg-primary">
                                        <div className="flex items-start gap-3 p-3">
                                            <div className="h-10 w-10 overflow-hidden rounded-full bg-bg-secondary">
                                                <img src={preview.avatarUrl} alt={target.authorUsername} className="h-full w-full object-cover" />
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <div className="text-[15px] font-semibold text-text-primary">{target.authorUsername}</div>
                                                    <div className="text-[15px] text-text-secondary">@{target.authorUsername}</div>
                                                    {typeof target.rtCount === 'number' && target.rtCount > 0 ? (
                                                        <div className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                                                            {target.rtCount} RT
                                                        </div>
                                                    ) : null}
                                                </div>

                                                <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[15px] leading-6 text-text-primary">
                                                    {preview.content}
                                                </p>

                                                {preview.url && (
                                                    <div className="mt-3 overflow-hidden rounded-2xl border border-border-subtle bg-text-primary">
                                                        {preview.isVideo ? (
                                                            <video
                                                                src={preview.url}
                                                                poster={preview.posterUrl ?? undefined}
                                                                controls
                                                                className="max-h-[18rem] w-full bg-black"
                                                            />
                                                        ) : (
                                                            <img src={preview.url} alt="Post medyasi" className="max-h-[18rem] w-full object-cover" />
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div
                            className="flex items-center justify-between border-t border-border-subtle px-4 pt-3"
                            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
                        >
                            <button
                                type="button"
                                onClick={() => onGifPickerOpenChange(true)}
                                disabled={quoteGif !== null}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-brand transition hover:bg-brand/10 disabled:opacity-50"
                                aria-label="GIF ekle"
                            >
                                <SmilePlus size={20} />
                            </button>

                            <div className={`text-sm font-medium ${guideDelta < 0 ? 'text-[#f4212e]' : guideDelta < 20 ? 'text-[#d4a853]' : 'text-text-secondary'}`}>
                                {charCount}/{guidelineLimit}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {gifPickerOpen && (
                <DeferredGifPicker
                    onClose={() => onGifPickerOpenChange(false)}
                    onSelect={(url) => {
                        onQuoteGifChange(url);
                        onGifPickerOpenChange(false);
                    }}
                />
            )}
        </>
    );
}
