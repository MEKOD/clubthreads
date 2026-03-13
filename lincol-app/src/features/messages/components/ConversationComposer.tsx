import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import { Image as ImageIcon, Loader2, Send, SmilePlus, X } from 'lucide-react';
import type { ComposerAttachment } from '../types';

function getComposerPlaceholder(canMessage: boolean, hasConversation: boolean) {
    if (!hasConversation) {
        return 'Mesaj yaz';
    }

    return canMessage
        ? 'Mesaj yaz'
        : 'Yeni mesaj icin karsilikli takip gerekli';
}

function AttachmentPreview({
    attachment,
    onClear,
    compact,
}: {
    attachment: ComposerAttachment;
    onClear: () => void;
    compact: boolean;
}) {
    return (
        <div className={`${compact ? 'mb-2' : 'mb-3'} overflow-hidden rounded-[22px] border border-[#ddcec2] bg-[#fffaf7] shadow-[0_10px_24px_rgba(70,46,31,0.08)] dark:border-[#1b1f27] dark:bg-[#0d0f14] dark:shadow-none`}>
            <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7c6657] dark:text-[#8c93a3]">
                <span>
                    {attachment.kind === 'gif'
                        ? 'GIF secildi'
                        : attachment.mediaMimeType.startsWith('video/')
                            ? 'Video secildi / max 30 sn / 8 MB'
                            : 'Foto secildi'}
                </span>
                <button
                    type="button"
                    onClick={onClear}
                    className="rounded-full p-1 text-[#7c6657] transition hover:bg-black/[0.04] dark:text-[#8c93a3] dark:hover:bg-white/[0.06]"
                    aria-label="Medyayi kaldir"
                >
                    <X size={14} />
                </button>
            </div>
            <div className="px-3 pb-3">
                {attachment.mediaMimeType.startsWith('video/') ? (
                    <video
                        src={attachment.previewUrl}
                        controls
                        className={`w-full rounded-[18px] bg-black object-contain ${compact ? 'max-h-56' : 'max-h-64'}`}
                    />
                ) : (
                    <img
                        src={attachment.previewUrl}
                        alt="Secilen medya"
                        className={`w-full rounded-[18px] object-cover ${compact ? 'max-h-56' : 'max-h-64'}`}
                    />
                )}
            </div>
        </div>
    );
}

interface ConversationComposerProps {
    variant: 'mobile' | 'desktop';
    formRef?: RefObject<HTMLFormElement | null>;
    textareaRef?: RefObject<HTMLTextAreaElement | null>;
    composerError: string | null;
    composerAttachment: ComposerAttachment | null;
    validatingAttachment: boolean;
    canMessage: boolean;
    hasConversation: boolean;
    composerText: string;
    canSubmitMessage: boolean;
    mobileComposerLift?: number;
    onSubmit: (event?: FormEvent<HTMLFormElement>) => void | Promise<void>;
    onClearAttachment: () => void;
    onOpenFilePicker: () => void;
    onOpenGifPicker: () => void;
    onTextChange: (value: string) => void;
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    onFocus: () => void;
    onBlur: () => void;
}

export function ConversationComposer({
    variant,
    formRef,
    textareaRef,
    composerError,
    composerAttachment,
    validatingAttachment,
    canMessage,
    hasConversation,
    composerText,
    canSubmitMessage,
    mobileComposerLift = 0,
    onSubmit,
    onClearAttachment,
    onOpenFilePicker,
    onOpenGifPicker,
    onTextChange,
    onKeyDown,
    onFocus,
    onBlur,
}: ConversationComposerProps) {
    const mobile = variant === 'mobile';
    const wrapperClassName = mobile
        ? 'fixed bottom-0 left-0 right-0 z-40 border-t border-[#ddcec2] bg-[#f5eee8]/96 backdrop-blur-xl dark:border-[#1b1f27] dark:bg-[#0a0b10]/96 md:hidden'
        : 'hidden border-t border-[#ddcec2] bg-[#f5eee8]/94 px-3 py-2.5 backdrop-blur-xl dark:border-[#1b1f27] dark:bg-[#0a0b10]/94 md:block';
    const contentClassName = mobile
        ? 'mx-auto w-full max-w-md px-3 pt-1'
        : 'mx-auto max-w-[880px]';
    const composerShellClassName = mobile
        ? 'flex min-w-0 flex-1 items-end gap-1.5 rounded-[22px] bg-[#fffaf7] px-2.5 py-1 shadow-[0_1px_0_rgba(70,46,31,0.08),0_8px_18px_rgba(70,46,31,0.06)] transition focus-within:shadow-[0_1px_0_rgba(70,46,31,0.08),0_12px_24px_rgba(70,46,31,0.08)] dark:bg-[#191c24] dark:shadow-none'
        : 'flex min-w-0 flex-1 items-end gap-2 rounded-[26px] bg-[#fffaf7] px-3 py-2 shadow-[0_1px_0_rgba(70,46,31,0.08),0_8px_18px_rgba(70,46,31,0.06)] transition focus-within:shadow-[0_1px_0_rgba(70,46,31,0.08),0_12px_24px_rgba(70,46,31,0.08)] dark:bg-[#191c24] dark:shadow-none';
    const iconButtonClassName = mobile
        ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#7c6657] transition hover:bg-[#f0e5dc] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#8c93a3] dark:hover:bg-[#242833]'
        : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#7c6657] transition hover:bg-[#f0e5dc] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#8c93a3] dark:hover:bg-[#242833]';
    const textareaClassName = mobile
        ? 'min-w-0 max-h-24 min-h-[16px] flex-1 resize-none bg-transparent py-1 text-[14px] leading-4 text-[#2f2823] outline-none placeholder:text-[#7c6657] disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#f1f3f7] dark:placeholder:text-[#8c93a3]'
        : 'min-w-0 max-h-28 min-h-[20px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-5 text-[#2f2823] outline-none placeholder:text-[#7c6657] disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#f1f3f7] dark:placeholder:text-[#8c93a3]';
    const sendButtonClassName = mobile
        ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-[0_8px_16px_rgba(69,169,207,0.28)] transition'
        : 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-[0_8px_16px_rgba(69,169,207,0.28)] transition';
    const textareaStyle = mobile
        ? {
            caretColor: '#45a9cf',
            WebkitTextFillColor: 'currentColor',
        }
        : undefined;

    return (
        <form
            ref={formRef}
            onSubmit={onSubmit}
            className={wrapperClassName}
            style={mobile
                ? {
                    bottom: mobileComposerLift > 0 ? `${mobileComposerLift}px` : undefined,
                    paddingBottom: 'calc(0.35rem + env(safe-area-inset-bottom))',
                }
                : undefined}
        >
            <div className={contentClassName}>
                {composerError ? (
                    <div className={`rounded-2xl border border-[#f0c36a] bg-[#fff6df] px-4 py-3 text-sm text-[#8a5a00] ${mobile ? 'mb-2' : 'mb-3'}`}>
                        {composerError}
                    </div>
                ) : null}

                {composerAttachment ? (
                    <AttachmentPreview
                        attachment={composerAttachment}
                        onClear={onClearAttachment}
                        compact={mobile}
                    />
                ) : null}

                <div className="flex w-full items-end gap-2">
                    <div className={composerShellClassName}>
                        <button
                            type="button"
                            onClick={onOpenFilePicker}
                            disabled={!canMessage || validatingAttachment}
                            className={iconButtonClassName}
                            aria-label="Galeriden medya sec"
                        >
                            {validatingAttachment ? <Loader2 className={`${mobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} animate-spin`} /> : <ImageIcon size={mobile ? 14 : 16} />}
                        </button>

                        <button
                            type="button"
                            onClick={onOpenGifPicker}
                            disabled={!canMessage}
                            className={iconButtonClassName}
                            aria-label="GIF sec"
                        >
                            <SmilePlus size={mobile ? 14 : 16} />
                        </button>

                        <textarea
                            ref={textareaRef}
                            value={composerText}
                            onChange={(event) => onTextChange(event.target.value)}
                            onKeyDown={onKeyDown}
                            onFocus={onFocus}
                            onBlur={onBlur}
                            placeholder={getComposerPlaceholder(canMessage, hasConversation)}
                            rows={1}
                            autoFocus
                            spellCheck
                            disabled={!canMessage}
                            className={textareaClassName}
                            style={textareaStyle}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={!canSubmitMessage}
                        className={`${sendButtonClassName} ${
                            !canSubmitMessage
                                ? 'bg-[#cdbfb4] shadow-none dark:bg-[#2b2f38]'
                                : 'bg-[#45a9cf] hover:scale-[1.02] dark:bg-[#356cff]'
                        }`}
                    >
                        <Send size={mobile ? 15 : 18} className="-rotate-12" />
                    </button>
                </div>
            </div>
        </form>
    );
}
