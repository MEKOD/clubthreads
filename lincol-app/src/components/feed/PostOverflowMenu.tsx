import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Copy, EyeOff, Link2, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import { api } from '../../lib/axios';
import { hidePost } from '../../lib/hiddenPosts';
import { blockUsername } from '../../lib/blockedUsers';

interface PostOverflowMenuProps {
    postId: string;
    authorUsername: string;
    content?: string | null;
    isOwner: boolean;
    onDeleted?: () => void;
    onBlocked?: () => void;
    onHidden?: () => void;
}

interface MenuPosition {
    left: number;
    top: number;
}

export function PostOverflowMenu({
    postId,
    authorUsername,
    content,
    isOwner,
    onDeleted,
    onBlocked,
    onHidden,
}: PostOverflowMenuProps) {
    const [open, setOpen] = useState(false);
    const [busyAction, setBusyAction] = useState<'delete' | 'block' | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

    const updateMenuPosition = useCallback(() => {
        if (!buttonRef.current) {
            return;
        }

        const buttonRect = buttonRef.current.getBoundingClientRect();
        const menuWidth = Math.max(menuRef.current?.offsetWidth ?? 236, 220);
        const menuHeight = menuRef.current?.offsetHeight ?? 0;
        const margin = 12;
        const mobileBottomInset = window.innerWidth < 768 ? 92 : 16;
        const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
        const left = Math.min(Math.max(buttonRect.right - menuWidth, margin), maxLeft);
        const canOpenUp = buttonRect.top - menuHeight - 8 >= margin;
        const shouldOpenUp = buttonRect.bottom + menuHeight + 8 > window.innerHeight - mobileBottomInset && canOpenUp;
        const rawTop = shouldOpenUp
            ? buttonRect.top - menuHeight - 8
            : buttonRect.bottom + 8;
        const maxTop = Math.max(margin, window.innerHeight - menuHeight - mobileBottomInset);
        const top = Math.min(Math.max(rawTop, margin), maxTop);

        setMenuPosition({ left, top });
    }, []);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node;
            if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
                setOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        const handleScroll = () => updateMenuPosition();

        updateMenuPosition();
        const rafId = window.requestAnimationFrame(() => updateMenuPosition());

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);
        document.addEventListener('keydown', handleEscape);
        window.addEventListener('resize', handleScroll);
        window.addEventListener('scroll', handleScroll, true);

        return () => {
            window.cancelAnimationFrame(rafId);
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
            window.removeEventListener('resize', handleScroll);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [open, updateMenuPosition]);

    const copyPostLink = async () => {
        await navigator.clipboard.writeText(`${window.location.origin}/post/${postId}`);
        setOpen(false);
    };

    const copyPostText = async () => {
        await navigator.clipboard.writeText((content ?? '').trim());
        setOpen(false);
    };

    const handleHide = () => {
        hidePost(postId);
        window.dispatchEvent(new CustomEvent('post-hidden', { detail: { postId } }));
        setOpen(false);
        onHidden?.();
    };

    const handleDelete = async () => {
        if (!window.confirm('Bu post silinsin mi?')) return;
        setBusyAction('delete');
        try {
            await api.delete(`/posts/${postId}`);
            window.dispatchEvent(new CustomEvent('post-deleted', { detail: { postId } }));
            setOpen(false);
            onDeleted?.();
        } catch (error) {
            console.error('Post silinemedi', error);
            window.alert('Post silinemedi.');
        } finally {
            setBusyAction(null);
        }
    };

    const handleBlock = async () => {
        if (!window.confirm(`@${authorUsername} engellensin mi?`)) return;
        setBusyAction('block');
        try {
            await api.post(`/users/${authorUsername}/block`);
            blockUsername(authorUsername);
            window.dispatchEvent(new CustomEvent('user-blocked', { detail: { username: authorUsername } }));
            setOpen(false);
            onBlocked?.();
        } catch (error) {
            console.error('Kullanici engellenemedi', error);
            window.alert('Kullanici engellenemedi.');
        } finally {
            setBusyAction(null);
        }
    };

    return (
        <div ref={rootRef} className="relative">
            <button
                ref={buttonRef}
                type="button"
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen((current) => !current);
                }}
                className="rounded-full p-2 text-text-secondary transition hover:bg-bg-secondary hover:text-text-primary"
                aria-label="Post menu"
                aria-expanded={open}
                aria-haspopup="menu"
            >
                <MoreHorizontal size={18} />
            </button>

            {open && menuPosition ? createPortal(
                <div
                    ref={menuRef}
                    role="menu"
                    onClick={(event) => event.stopPropagation()}
                    className="fixed z-[95] min-w-[220px] overflow-hidden rounded-2xl border border-border bg-bg-primary shadow-[0_18px_40px_rgba(15,20,25,0.22)]"
                    style={{
                        left: `${menuPosition.left}px`,
                        top: `${menuPosition.top}px`,
                    }}
                >
                    <button
                        type="button"
                        onClick={() => void copyPostLink()}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-text-primary transition hover:bg-bg-secondary"
                    >
                        <Link2 size={16} />
                        Baglantiyi kopyala
                    </button>

                    <button
                        type="button"
                        onClick={() => void copyPostText()}
                        disabled={!content?.trim()}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-text-primary transition hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Copy size={16} />
                        Metni kopyala
                    </button>

                    <button
                        type="button"
                        onClick={handleHide}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-text-primary transition hover:bg-bg-secondary"
                    >
                        <EyeOff size={16} />
                        Gonderiyi gizle
                    </button>

                    {isOwner ? (
                        <button
                            type="button"
                            onClick={() => void handleDelete()}
                            disabled={busyAction !== null}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#b42318] transition hover:bg-[#fff1f1] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {busyAction === 'delete' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            Postu sil
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => void handleBlock()}
                            disabled={busyAction !== null}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#b42318] transition hover:bg-[#fff1f1] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {busyAction === 'block' ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
                            @{authorUsername} engelle
                        </button>
                    )}
                </div>,
                document.body
            ) : null}
        </div>
    );
}
