import { useEffect, useRef, useState } from 'react';
import { BarChart2, Image as ImageIcon, Loader2, MinusCircle, PlusCircle, SmilePlus, Video, X } from 'lucide-react';
import axios from 'axios';
import { api, getAvatarUrl } from '../../lib/axios';
import { useAuthStore } from '../../store/authStore';
import { DeferredGifPicker } from '../ui/DeferredGifPicker';
import { MentionTextarea } from '../ui/MentionTextarea';
import { trackAnalyticsEvent } from '../../lib/analytics';
import { useMobileKeyboardInset } from '../../hooks/useMobileKeyboardInset';

const MAX_MEDIA_SIZE_BYTES = 15 * 1024 * 1024;

interface QuickComposerProps {
    communitySlug?: string;
    autoFocus?: boolean;
    compact?: boolean;
    initialContent?: string;
    onPosted?: (payload: {
        id: string;
        content: string | null;
        mediaUrl: string | null;
        mediaMimeType: string | null;
    }) => void | Promise<void>;
}

export function QuickComposer({ communitySlug, autoFocus = false, compact = false, initialContent = '', onPosted }: QuickComposerProps) {
    const [content, setContent] = useState(initialContent);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedGif, setSelectedGif] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isGifPickerOpen, setIsGifPickerOpen] = useState(false);
    const [isPollOpen, setIsPollOpen] = useState(false);
    const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
    const [pollDuration, setPollDuration] = useState<number>(24);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const initializedInitialContentRef = useRef(false);
    const user = useAuthStore((state) => state.user);
    const keyboardInset = useMobileKeyboardInset(!compact);

    useEffect(() => {
        if (initializedInitialContentRef.current) {
            return;
        }
        if (!initialContent.trim()) {
            initializedInitialContentRef.current = true;
            return;
        }
        setContent(initialContent);
        initializedInitialContentRef.current = true;
    }, [initialContent]);

    useEffect(() => {
        trackAnalyticsEvent({
            eventType: 'composer_open',
            surface: communitySlug ? 'community_composer' : 'global_composer',
            ...(communitySlug ? { entityType: 'community' as const, entityId: communitySlug } : {}),
        });
    }, [communitySlug]);

    const validateMediaFile = (file: File | null) => {
        if (!file) return { ok: true as const };
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
            return { ok: false as const, error: 'Sadece foto veya video yukleyebilirsin.' };
        }
        if (file.size > MAX_MEDIA_SIZE_BYTES) {
            return { ok: false as const, error: 'Medya boyutu en fazla 15 MB olabilir.' };
        }
        return { ok: true as const };
    };

    const applySelectedFile = (file: File | null) => {
        const result = validateMediaFile(file);
        if (!result.ok) {
            setSelectedFile(null);
            setSelectedGif(null);
            setSubmitError(result.error);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            return;
        }

        setSubmitError(null);
        setSelectedFile(file);
        if (file) {
            setSelectedGif(null);
        }
    };

    useEffect(() => {
        if (selectedFile) {
            const objectUrl = URL.createObjectURL(selectedFile);
            setPreviewUrl(objectUrl);
            return () => URL.revokeObjectURL(objectUrl);
        } else if (selectedGif) {
            setPreviewUrl(selectedGif);
            return;
        }

        setPreviewUrl(null);
    }, [selectedFile, selectedGif]);

    const resetComposer = () => {
        setContent('');
        setSelectedFile(null);
        setSelectedGif(null);
        setPreviewUrl(null);
        setIsPollOpen(false);
        setPollOptions(['', '']);
        setPollDuration(24);
    };

    const handleSubmit = async (event?: React.FormEvent) => {
        event?.preventDefault();

        const validPollOptions = isPollOpen ? pollOptions.map(o => o.trim()).filter(Boolean) : [];
        if ((!content.trim() && !selectedFile && !selectedGif && validPollOptions.length < 2) || isSubmitting) {
            return;
        }

        setIsSubmitting(true);
        setSubmitError(null);
        try {
            let mediaUrl: string | undefined;
            let mediaMimeType: string | undefined;

            if (selectedFile) {
                const formData = new FormData();
                formData.append('file', selectedFile);

                const mediaResponse = await api.post('/media/upload', formData, {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                });

                mediaUrl = mediaResponse.data.url ?? undefined;
                mediaMimeType = mediaResponse.data.mimeType;
            } else if (selectedGif) {
                mediaUrl = selectedGif;
                mediaMimeType = 'image/gif';
            }

            let pollData = undefined;
            if (isPollOpen) {
                const filledOptions = pollOptions.map(o => o.trim()).filter(Boolean);
                if (filledOptions.length >= 2) {
                    pollData = {
                        options: filledOptions,
                        durationHours: pollDuration
                    };
                }
            }

            const endpoint = communitySlug ? `/communities/${communitySlug}/posts` : '/posts';
            const postResponse = await api.post(endpoint, {
                type: 'post',
                content: content.trim() || undefined,
                mediaUrl,
                mediaMimeType,
                poll: pollData,
            });

            trackAnalyticsEvent({
                eventType: 'composer_submit',
                surface: communitySlug ? 'community_composer' : 'global_composer',
                entityType: 'post',
                entityId: postResponse.data.post.id,
            });

            resetComposer();
            await onPosted?.({
                id: postResponse.data.post.id,
                content: postResponse.data.post.content ?? null,
                mediaUrl: postResponse.data.post.mediaUrl ?? null,
                mediaMimeType: postResponse.data.post.mediaMimeType ?? null,
            });
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const detail = error.response?.data?.detail;
                const message = error.response?.data?.error || error.response?.data?.message;
                if (status === 503 && selectedFile?.type.startsWith('video/')) {
                    setSubmitError(detail || 'Sunucu su an video isleme acisindan yogun. Birazdan tekrar dene.');
                    return;
                }
                setSubmitError(
                    detail ||
                    message ||
                    'Post gönderilemedi. Birazdan tekrar dene.'
                );
            } else {
                setSubmitError('Post gönderilemedi. Birazdan tekrar dene.');
            }
            console.error('Failed to post', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const validPollOptions = isPollOpen ? pollOptions.map((option) => option.trim()).filter(Boolean) : [];
    const canSubmit = Boolean(content.trim() || selectedFile || selectedGif || validPollOptions.length >= 2) && !isSubmitting;
    const characterCount = content.length;
    const guidelineLimit = 280;
    const guideDelta = guidelineLimit - characterCount;
    const audienceLabel = communitySlug ? `/${communitySlug}` : 'Herkes';
    const activeAttachmentLabel = isPollOpen
        ? `${validPollOptions.length || 2} secenekli anket`
        : selectedFile?.type.startsWith('video/')
          ? 'Video secildi'
          : selectedFile
            ? 'Foto secildi'
            : selectedGif
              ? 'GIF secildi'
              : null;
    const submitLabel = isSubmitting
        ? (selectedFile?.type.startsWith('video/') ? 'Video isleniyor...' : 'Gonderiliyor...')
        : 'Post';
    const placeholder = communitySlug ? `/${communitySlug} icin ne paylasmak istiyorsun?` : 'Neler oluyor?';
    const showCounter = characterCount > 0 || guideDelta < 40;
    const isNearLimit = guideDelta < 20;
    const isOverLimit = guideDelta < 0;
    const isVideoSelected = Boolean(selectedFile?.type.startsWith('video/'));

    return (
        <form
            onSubmit={handleSubmit}
            className={compact ? '' : 'h-full'}
        >
            {submitError && (submitError.toLowerCase().includes('video isleme') || submitError.toLowerCase().includes('yogun')) && (
                <div className="mb-3 rounded-2xl border border-[#f0c36a] bg-[#fff6df] px-4 py-3 text-sm text-[#8a5a00]">
                    {submitError}
                </div>
            )}

            <div className={compact
                ? 'overflow-hidden rounded-[24px] border border-border-subtle bg-bg-primary shadow-[0_12px_32px_rgba(15,20,25,0.06)]'
                : 'flex h-full min-h-0 flex-col bg-bg-primary'}
                style={!compact && keyboardInset > 0 ? { paddingBottom: `${keyboardInset}px` } : undefined}
            >
                <div className={compact ? 'px-4 py-4' : 'flex-1 px-4 py-3 md:px-5 md:py-4'}>
                    <div className="flex items-start gap-3">
                        <div className={`${compact ? 'h-10 w-10' : 'h-11 w-11'} overflow-hidden rounded-full bg-bg-secondary`}>
                            <img src={getAvatarUrl(user?.username, user?.profilePic)} alt={user?.username || 'you'} className="h-full w-full object-cover" />
                        </div>

                        <div className="min-w-0 flex-1">
                            <button
                                type="button"
                                className="inline-flex h-8 items-center rounded-full border border-brand/20 bg-brand/5 px-3 text-[13px] font-semibold text-brand"
                            >
                                {audienceLabel}
                            </button>

                            <MentionTextarea
                                autoFocus={autoFocus}
                                value={content}
                                onValueChange={setContent}
                                onPaste={(e) => {
                                    const items = e.clipboardData?.items;
                                    if (items) {
                                        for (let i = 0; i < items.length; i++) {
                                            if (items[i].type.indexOf('image/') !== -1) {
                                                const file = items[i].getAsFile();
                                                if (file) {
                                                    applySelectedFile(file);
                                                    e.preventDefault();
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }}
                                placeholder={placeholder}
                                containerClassName="mt-3 w-full"
                                className={`w-full resize-none border-0 bg-transparent p-0 text-text-primary outline-none placeholder:text-text-muted ${compact ? 'min-h-[128px] text-[20px] leading-[1.45]' : 'min-h-[140px] text-[22px] leading-[1.4] md:min-h-[180px] md:text-[24px]'}`}
                            />

                            {previewUrl && !isPollOpen && (
                                <div className="relative mt-4 overflow-hidden rounded-[20px] border border-border-subtle bg-text-primary">
                                    {isVideoSelected ? (
                                        <video src={previewUrl} controls className="max-h-[30rem] w-full bg-black" />
                                    ) : (
                                        <img src={previewUrl} alt="Secilen medya" className="max-h-[30rem] w-full object-cover" />
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedFile(null);
                                            setSelectedGif(null);
                                            setSubmitError(null);
                                        }}
                                        className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-overlay-dark text-inverse-primary"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            )}

                            {isPollOpen && (
                                <div className="mt-4 overflow-hidden rounded-[20px] border border-border-subtle bg-bg-primary">
                                    <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                                        <div>
                                            <div className="text-sm font-semibold text-text-primary">Anket</div>
                                            <div className="mt-0.5 text-xs text-text-secondary">En az iki secenek gerekli.</div>
                                        </div>
                                        <button type="button" onClick={() => setIsPollOpen(false)} className="rounded-full p-2 text-text-secondary transition hover:bg-bg-secondary">
                                            <X size={16} />
                                        </button>
                                    </div>

                                    <div className="space-y-3 p-4">
                                        {pollOptions.map((opt, idx) => (
                                            <div key={idx} className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={opt}
                                                    onChange={(e) => {
                                                        const newOpts = [...pollOptions];
                                                        newOpts[idx] = e.target.value;
                                                        setPollOptions(newOpts);
                                                    }}
                                                    placeholder={`Secenek ${idx + 1}${idx >= 2 ? ' (istege bagli)' : ''}`}
                                                    className="min-w-0 flex-1 rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3 text-[14px] outline-none focus:border-brand focus:bg-bg-primary"
                                                    maxLength={50}
                                                />
                                                {idx >= 2 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const newOpts = [...pollOptions];
                                                            newOpts.splice(idx, 1);
                                                            setPollOptions(newOpts);
                                                        }}
                                                        className="shrink-0 rounded-full p-2 text-[#f91880] transition hover:bg-[#ffe5f2]"
                                                    >
                                                        <MinusCircle size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}

                                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
                                            <button
                                                type="button"
                                                onClick={() => setPollOptions([...pollOptions, ''])}
                                                disabled={pollOptions.length >= 4}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-3.5 py-2 text-sm font-medium text-text-primary transition hover:bg-bg-secondary disabled:opacity-50"
                                            >
                                                <PlusCircle size={16} />
                                                Secenek ekle
                                            </button>

                                            <label className="flex items-center gap-2 text-sm text-text-secondary">
                                                <span>Anket suresi</span>
                                                <select
                                                    value={pollDuration}
                                                    onChange={(e) => setPollDuration(Number(e.target.value))}
                                                    className="rounded-full border border-border-subtle bg-bg-secondary px-3 py-2 text-[13px] outline-none"
                                                >
                                                    <option value={24}>1 gun</option>
                                                    <option value={72}>3 gun</option>
                                                    <option value={168}>7 gun</option>
                                                </select>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div
                    className={`border-t border-border-subtle bg-bg-primary/96 ${compact ? 'px-4 py-3' : 'px-4 pt-2.5 md:px-5'} backdrop-blur`}
                    style={!compact ? { paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' } : undefined}
                >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-brand">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*,video/*"
                                className="hidden"
                                onChange={(event) => applySelectedFile(event.target.files?.[0] ?? null)}
                            />

                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={selectedGif !== null || isPollOpen}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-brand/10 disabled:opacity-50"
                                aria-label="Foto veya video ekle"
                            >
                                {isVideoSelected ? <Video size={20} /> : <ImageIcon size={20} />}
                            </button>

                            <button
                                type="button"
                                onClick={() => setIsGifPickerOpen(true)}
                                disabled={selectedFile !== null || isPollOpen}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-brand/10 disabled:opacity-50"
                                aria-label="GIF ekle"
                            >
                                <SmilePlus size={20} />
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setIsPollOpen(true);
                                    setSelectedFile(null);
                                    setSelectedGif(null);
                                    setPreviewUrl(null);
                                }}
                                disabled={selectedFile !== null || selectedGif !== null || isPollOpen}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-brand/10 disabled:opacity-50"
                                aria-label="Anket ekle"
                            >
                                <BarChart2 size={20} />
                            </button>

                            {activeAttachmentLabel ? (
                                <span className="ml-1 truncate text-xs text-text-muted">{activeAttachmentLabel}</span>
                            ) : null}
                        </div>

                        <div className="flex items-center gap-3">
                            {showCounter ? (
                                <div className={`text-sm font-medium ${isOverLimit ? 'text-[#f4212e]' : isNearLimit ? 'text-[#d4a853]' : 'text-text-secondary'}`}>
                                    {characterCount}/{guidelineLimit}
                                </div>
                            ) : null}
                            <button
                                type="submit"
                                disabled={!canSubmit}
                                className="inline-flex h-10 min-w-[92px] items-center justify-center rounded-full bg-text-primary px-4 text-sm font-bold text-inverse-primary transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : submitLabel}
                            </button>
                        </div>
                    </div>

                    {submitError && !(submitError.toLowerCase().includes('video isleme') || submitError.toLowerCase().includes('yogun')) && (
                        <p className="mt-3 rounded-2xl border border-[#f3c6bb] bg-[#fff2ee] px-4 py-3 text-sm text-[#b14d2e]">
                            {submitError}
                        </p>
                    )}
                </div>
            </div>
            {isGifPickerOpen && (
                <DeferredGifPicker
                    onClose={() => setIsGifPickerOpen(false)}
                    onSelect={(url) => {
                        setSelectedGif(url);
                        setSelectedFile(null);
                        setIsGifPickerOpen(false);
                    }}
                />
            )}
        </form>
    );
}
