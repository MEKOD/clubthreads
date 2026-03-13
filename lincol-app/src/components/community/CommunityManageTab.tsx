import { AlertTriangle, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { useState, type ChangeEvent, type RefObject } from 'react';
import type { CommunityDetail } from '../../lib/social';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface CommunityManageTabProps {
    form: {
        name: string;
        description: string;
        bannerUrl: string;
        isPrivate: boolean;
    };
    saving: boolean;
    deleting: boolean;
    avatarPreviewUrl: string | null;
    avatarInputRef: RefObject<HTMLInputElement | null>;
    community: CommunityDetail;
    onChange: (next: Partial<CommunityManageTabProps['form']>) => void;
    onAvatarSelect: (event: ChangeEvent<HTMLInputElement>) => void;
    onAvatarRemove: () => void;
    onSave: () => void;
    onDelete: () => void;
}

export function CommunityManageTab({
    form,
    saving,
    deleting,
    avatarPreviewUrl,
    avatarInputRef,
    community,
    onChange,
    onAvatarSelect,
    onAvatarRemove,
    onSave,
    onDelete,
}: CommunityManageTabProps) {
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    useBodyScrollLock(isDeleteDialogOpen);

    return (
        <div className="space-y-4">
            {isDeleteDialogOpen && (
                <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-3 md:items-center" onClick={() => setIsDeleteDialogOpen(false)}>
                    <div
                        onClick={(event) => event.stopPropagation()}
                        className="w-full max-w-sm rounded-[28px] bg-bg-primary p-5 shadow-[0_30px_80px_rgba(17,17,17,0.2)]"
                    >
                        <div className="text-base font-semibold text-text-primary">Toplulugu sil?</div>
                        <p className="mt-2 text-sm leading-6 text-text-secondary">
                            /{community.slug} kalici olarak silinecek. Postlar, kurallar ve uyelikler geri gelmez.
                        </p>
                        <div className="mt-5 flex gap-2">
                            <button
                                type="button"
                                onClick={() => setIsDeleteDialogOpen(false)}
                                className="flex-1 rounded-full border border-border-subtle px-4 py-2.5 text-sm font-medium text-text-primary"
                            >
                                Vazgec
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsDeleteDialogOpen(false);
                                    onDelete();
                                }}
                                disabled={deleting}
                                className="flex-1 rounded-full bg-[#b42318] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                            >
                                {deleting ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Sil'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="rounded-[24px] border border-black/[0.06] bg-bg-primary/95 p-5 shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                <div className="text-sm font-semibold text-text-primary">Community ayarlari</div>
                <div className="mt-4 space-y-3">
                    <input
                        value={form.name}
                        onChange={(event) => onChange({ name: event.target.value })}
                        placeholder="Topluluk adi"
                        className="w-full rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm outline-none placeholder:text-text-muted focus:border-black/20"
                    />
                    <textarea
                        value={form.description}
                        onChange={(event) => onChange({ description: event.target.value })}
                        placeholder="Aciklama"
                        rows={3}
                        className="w-full resize-none rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm outline-none placeholder:text-text-muted focus:border-black/20"
                    />
                    <div className="rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-4">
                        <div className="mb-3 text-sm font-semibold text-text-primary">Community fotografi</div>
                        <div className="flex items-center gap-4">
                            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-bg-primary text-lg font-black text-text-primary">
                                {avatarPreviewUrl ? (
                                    <img src={avatarPreviewUrl} alt={community.name} className="h-full w-full object-cover" />
                                ) : (
                                    community.name[0]?.toUpperCase()
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    ref={avatarInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={onAvatarSelect}
                                />
                                <button
                                    type="button"
                                    onClick={() => avatarInputRef.current?.click()}
                                    className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-bg-primary px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-white/5"
                                >
                                    <ImageIcon size={16} />
                                    Fotograf sec
                                </button>
                                {avatarPreviewUrl && (
                                    <button
                                        type="button"
                                        onClick={onAvatarRemove}
                                        className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-text-secondary transition hover:bg-bg-primary"
                                    >
                                        <X size={14} />
                                        Kaldir
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    <input
                        value={form.bannerUrl}
                        onChange={(event) => onChange({ bannerUrl: event.target.value })}
                        placeholder="Banner URL"
                        className="w-full rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm outline-none placeholder:text-text-muted focus:border-black/20"
                    />
                    <label className="flex items-center justify-between rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm text-text-primary">
                        <div>
                            <div className="font-semibold">Private community</div>
                            <div className="mt-1 text-xs text-text-secondary">Private olursa icerik sadece uye olanlara gorunur.</div>
                        </div>
                        <input
                            type="checkbox"
                            checked={form.isPrivate}
                            onChange={(event) => onChange({ isPrivate: event.target.checked })}
                            className="h-4 w-4 accent-text-primary"
                        />
                    </label>
                </div>
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saving || !form.name.trim()}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-text-primary px-5 py-2.5 text-sm font-semibold text-inverse-primary disabled:opacity-50"
                >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                    Degisiklikleri kaydet
                </button>
            </div>

            <div className="rounded-[24px] border border-[#f0c7c7] bg-[#fff6f6] p-5 shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-[#b42318]" />
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[#7a271a]">Toplulugu sil</div>
                        <p className="mt-1 text-sm leading-6 text-[#9f3a28]">
                            /{community.slug} silinirse feed, kurallar ve uye baglantilari da kalici olarak gider.
                        </p>
                        <button
                            type="button"
                            onClick={() => setIsDeleteDialogOpen(true)}
                            disabled={deleting}
                            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#b42318] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            {deleting ? <Loader2 size={14} className="animate-spin" /> : null}
                            Toplulugu sil
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
