import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '../lib/axios';
import { getAuthFieldErrors } from '../lib/authErrors';
import { TurnstileWidget } from '../components/ui/TurnstileWidget';
import { ensureDmCryptoForSession } from '../features/messages/crypto';
import { useAuthStore } from '../store/authStore';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

export function Register() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [usernameError, setUsernameError] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [generalError, setGeneralError] = useState('');
    const [turnstileToken, setTurnstileToken] = useState('');
    const navigate = useNavigate();
    const setAuth = useAuthStore((state) => state.setAuth);
    const showErrorPopup = Boolean(generalError);

    useBodyScrollLock(showErrorPopup);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setUsernameError('');
        setPasswordError('');
        setGeneralError('');

        const clean = username.trim().toLowerCase();
        if (!clean) {
            setUsernameError('Kullanıcı adı zorunlu.');
        }

        if (!password.trim()) {
            setPasswordError('Şifre zorunlu.');
        }

        if (!clean || !password.trim()) {
            setIsLoading(false);
            return;
        }

        if (!/^[a-z0-9._-]+$/.test(clean)) {
            setUsernameError('Kullanıcı adında sadece İngilizce harf, rakam, nokta, tire ve alt çizgi kullanılabilir.');
            setIsLoading(false);
            return;
        }

        if (clean.length < 3) {
            setUsernameError('Kullanıcı adı en az 3 karakter olmalı.');
            setIsLoading(false);
            return;
        }

        if (clean.length > 32) {
            setUsernameError('Kullanıcı adı en fazla 32 karakter olabilir.');
            setIsLoading(false);
            return;
        }

        if (password.length < 8) {
            setPasswordError('Şifre en az 8 karakter olmalı.');
            setIsLoading(false);
            return;
        }

        if (import.meta.env.VITE_TURNSTILE_SITE_KEY && !turnstileToken) {
            setGeneralError('Devam etmek icin captcha dogrulamasi gerekli.');
            setIsLoading(false);
            return;
        }

        try {
            const response = await api.post('/auth/register', { username: clean, password, turnstileToken });
            const { token, user, dmCrypto } = response.data;

            setAuth(user, token);
            await ensureDmCryptoForSession({
                userId: user.id,
                password,
                bundle: dmCrypto,
            });
            navigate('/');
        } catch (error: unknown) {
            const { username, password, general } = getAuthFieldErrors(error);
            setUsernameError(username || '');
            setPasswordError(password || '');
            setGeneralError(general || (error instanceof Error ? error.message : 'Kayit tamamlanamadi.'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-bg-primary selection:bg-text-primary selection:text-inverse-primary">
            {showErrorPopup && (
                <div
                    className="fixed inset-0 z-[80] flex items-end justify-center bg-overlay px-4 pb-4 md:items-center md:p-4"
                    onClick={() => setGeneralError('')}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className="w-full max-w-sm rounded-3xl bg-bg-primary p-5 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="text-lg font-bold text-text-primary">Islem durduruldu</div>
                        <p className="mt-2 text-sm leading-6 text-text-secondary">{generalError}</p>
                        <button
                            type="button"
                            onClick={() => setGeneralError('')}
                            className="mt-5 w-full rounded-2xl bg-text-primary py-3 text-sm font-semibold text-inverse-primary"
                        >
                            Tamam
                        </button>
                    </motion.div>
                </div>
            )}

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-sm"
            >
                <div className="mb-12 text-center">
                    <motion.div
                        initial={{ scale: 0.9 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 200, damping: 20 }}
                        className="w-12 h-12 bg-text-primary rounded-2xl mx-auto mb-6 flex items-center justify-center"
                    >
                        <span className="text-[#d4a853] font-bold text-base">CT</span>
                    </motion.div>
                    <h1 className="text-3xl font-bold tracking-tight text-text-primary mb-2">Hesap Oluştur</h1>
                    <p className="text-text-secondary text-sm">Kullanıcı adın `.` `-` ve `_` içerebilir</p>
                </div>

                <form onSubmit={handleRegister} className="space-y-6">
                    <div className="space-y-4">
                        <div>
                            <input
                                type="text"
                                placeholder="Kullanıcı adı (ör: ahmet.yilmaz)"
                                value={username}
                                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                                className={`w-full bg-transparent border-b px-0 py-4 text-text-primary placeholder:text-text-muted focus:outline-none transition-colors ${usernameError ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-border'}`}
                                required
                            />
                            {usernameError ? (
                                <p className="mt-1.5 text-xs text-red-500">{usernameError}</p>
                            ) : (
                                <p className="mt-1.5 text-xs text-text-muted">3-32 karakter. Harf, rakam, nokta, tire ve alt çizgi kullanılabilir.</p>
                            )}
                        </div>
                        <div>
                            <input
                                type="password"
                                placeholder="Şifre"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={`w-full bg-transparent border-b px-0 py-4 text-text-primary placeholder:text-text-muted focus:outline-none transition-colors ${passwordError ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-border'}`}
                                required
                            />
                            {passwordError ? (
                                <p className="mt-1.5 text-xs text-red-500">{passwordError}</p>
                            ) : (
                                <p className="mt-1.5 text-xs text-text-muted">En az 8 karakter olmalı.</p>
                            )}
                        </div>
                    </div>

                    <TurnstileWidget onTokenChange={setTurnstileToken} onError={setGeneralError} />

                    <motion.button
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.97 }}
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-text-primary text-inverse-primary rounded-2xl py-4 font-medium flex items-center justify-center disabled:opacity-70 transition-opacity mt-4"
                    >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Hesap Oluştur'}
                    </motion.button>
                </form>

                <div className="mt-8 text-center">
                    <p className="text-text-secondary text-sm">
                        Zaten hesabın var mı?{' '}
                        <Link to="/login" className="text-text-primary font-medium hover:underline underline-offset-4">
                            Giriş yap
                        </Link>
                    </p>
                </div>
            </motion.div>
        </div>
    );
}
