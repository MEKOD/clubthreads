import { useEffect, useState } from 'react';
import { LogOut, ShieldCheck, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useAuthStore } from '../../store/authStore';
import { useDmCryptoStore } from '../../store/dmCryptoStore';

export function DmCryptoRelogPrompt({ active }: { active: boolean }) {
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const logout = useAuthStore((state) => state.logout);
    const dmCryptoHydrated = useDmCryptoStore((state) => state.hydrated);
    const dmCryptoOwnerUserId = useDmCryptoStore((state) => state.ownerUserId);
    const dmPublicKey = useDmCryptoStore((state) => state.publicKey);
    const dmPrivateKey = useDmCryptoStore((state) => state.privateKey);
    const [dismissed, setDismissed] = useState(false);

    const visible = Boolean(
        active
        && user
        && dmCryptoHydrated
        && !dismissed
        && (dmCryptoOwnerUserId !== user.id || !dmPublicKey || !dmPrivateKey)
    );

    useEffect(() => {
        setDismissed(false);
    }, [user?.id]);

    useBodyScrollLock(visible);

    if (!visible) {
        return null;
    }

    const handleLogout = () => {
        logout();
        navigate('/login', { replace: true });
    };

    return (
        <div
            className="fixed inset-0 z-[75] flex items-end justify-center bg-overlay px-4 pb-4 md:items-center md:p-4"
            onClick={() => setDismissed(true)}
        >
            <div
                className="w-full max-w-md rounded-[28px] border border-border-subtle bg-bg-primary p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)]"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-text-primary text-inverse-primary">
                            <ShieldCheck size={18} />
                        </div>
                        <div>
                            <div className="text-sm font-semibold uppercase tracking-[0.14em] text-text-secondary">
                                Mesaj güvenliği
                            </div>
                            <div className="mt-1 text-lg font-bold text-text-primary">
                                Bir kez yeniden giriş yap
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setDismissed(true)}
                        className="rounded-full p-1.5 text-text-muted hover:bg-black/5"
                        aria-label="Kapat"
                    >
                        <X size={16} />
                    </button>
                </div>

                <p className="mt-4 text-sm leading-6 text-text-secondary">
                    Mesajlarının şifreli ve güvenli gittiğinden emin olmak için bir kere oturumu kapatıp açmanı tavsiye ediyoruz.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => setDismissed(true)}
                        className="rounded-2xl bg-bg-tertiary px-4 py-3 text-sm font-semibold text-text-primary"
                    >
                        Daha sonra
                    </button>
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-text-primary px-4 py-3 text-sm font-semibold text-inverse-primary"
                    >
                        <LogOut size={16} />
                        Oturumu kapat
                    </button>
                </div>
            </div>
        </div>
    );
}
