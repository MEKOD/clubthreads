import { useEffect, useRef, useState } from 'react';
import { Loader2, SendHorizontal } from 'lucide-react';
import { api, getAvatarUrl } from '../../lib/axios';
import { useAuthStore } from '../../store/authStore';
import { MentionTextarea } from '../ui/MentionTextarea';

interface InlineReplyInputProps {
    postId: string;
    authorUsername: string;
    onReplied?: () => void;
    onClose?: () => void;
}

export function InlineReplyInput({ postId, authorUsername, onReplied, onClose }: InlineReplyInputProps) {
    const [content, setContent] = useState(`@${authorUsername} `);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        const el = inputRef.current;
        if (el) {
            el.focus();
            const len = el.value.length;
            el.setSelectionRange(len, len);
        }
    }, []);
    const user = useAuthStore((state) => state.user);

    const handleSubmit = async () => {
        const trimmed = content.trim();
        if (!trimmed || isSubmitting) return;

        setIsSubmitting(true);
        setError(null);
        try {
            await api.post('/posts', {
                type: 'post',
                content: trimmed,
                parentId: postId,
            });
            setContent('');
            onReplied?.();
            onClose?.();
        } catch (err) {
            setError('Gonderilemedi');
            console.error('Inline reply failed:', err);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSubmit();
        }
        if (e.key === 'Escape') {
            onClose?.();
        }
    };

    return (
        <div className="mt-2">
            <div className="flex items-start gap-2 rounded-2xl border border-border-subtle bg-bg-secondary/50 p-2.5">
                <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-border">
                    <img
                        src={getAvatarUrl(user?.username, user?.profilePic)}
                        alt={user?.username || ''}
                        className="h-full w-full object-cover"
                    />
                </div>
                <MentionTextarea
                    ref={inputRef}
                    value={content}
                    onValueChange={setContent}
                    onKeyDown={handleKeyDown}
                    placeholder={`@${authorUsername}'e yanıt...`}
                    rows={1}
                    containerClassName="w-full"
                    className="min-h-[32px] w-full resize-none bg-transparent text-[14px] leading-[20px] text-text-primary outline-none placeholder:text-text-muted"
                    style={{ height: 'auto', maxHeight: '120px' }}
                    onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                    }}
                />
                <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!content.trim() || isSubmitting}
                    className="mt-0.5 shrink-0 rounded-full p-1.5 text-text-secondary transition-colors hover:bg-brand/10 hover:text-brand disabled:opacity-40"
                >
                    {isSubmitting ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : (
                        <SendHorizontal size={16} />
                    )}
                </button>
            </div>
            {error && (
                <p className="mt-1 text-xs text-[#b14d2e]">{error}</p>
            )}
            <div className="mt-1 flex items-center justify-between px-1">
                <span className="text-[11px] text-text-muted">Enter gonder · Esc kapat</span>
                <button
                    type="button"
                    onClick={onClose}
                    className="text-[11px] font-medium text-text-secondary hover:text-text-primary"
                >
                    Vazgec
                </button>
            </div>
        </div>
    );
}
