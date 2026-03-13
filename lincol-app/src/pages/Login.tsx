import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '../lib/axios';
import { getAuthFieldErrors } from '../lib/authErrors';
import { ensureDmCryptoForSession } from '../features/messages/crypto';
import { useAuthStore } from '../store/authStore';

export function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [usernameError, setUsernameError] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [generalError, setGeneralError] = useState('');
    const navigate = useNavigate();
    const setAuth = useAuthStore((state) => state.setAuth);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setUsernameError('');
        setPasswordError('');
        setGeneralError('');

        if (!username.trim()) {
            setUsernameError('Kullanıcı adı zorunlu.');
        }

        if (!password.trim()) {
            setPasswordError('Şifre zorunlu.');
        }

        if (!username.trim() || !password.trim()) {
            setIsLoading(false);
            return;
        }

        try {
            const response = await api.post('/auth/login', { username: username.trim(), password });
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
            setGeneralError(general || (error instanceof Error ? error.message : 'Giris tamamlanamadi.'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-bg-primary selection:bg-text-primary selection:text-inverse-primary">
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
                    <h1 className="text-3xl font-bold tracking-tight text-text-primary mb-2">Welcome Back</h1>
                    <p className="text-text-secondary text-sm">Hesabına giriş yap</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div className="space-y-4">
                        <div>
                            <input
                                type="text"
                                placeholder="Kullanıcı adı"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className={`w-full bg-transparent border-b px-0 py-4 text-text-primary placeholder:text-text-muted focus:outline-none transition-colors ${usernameError ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-border'}`}
                                required
                            />
                            {usernameError ? <p className="mt-1.5 text-xs text-red-500">{usernameError}</p> : null}
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
                            {passwordError ? <p className="mt-1.5 text-xs text-red-500">{passwordError}</p> : null}
                        </div>
                    </div>

                    {generalError && (
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-red-500 text-sm font-medium"
                        >
                            {generalError}
                        </motion.p>
                    )}

                    <motion.button
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.97 }}
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-text-primary text-inverse-primary rounded-2xl py-4 font-medium flex items-center justify-center disabled:opacity-70 transition-opacity"
                    >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Giriş Yap'}
                    </motion.button>
                </form>

                <div className="mt-8 text-center">
                    <p className="text-text-secondary text-sm">
                        Hesabın yok mu?{' '}
                        <Link to="/register" className="text-text-primary font-medium hover:underline underline-offset-4">
                            Hesap oluştur
                        </Link>
                    </p>
                </div>
            </motion.div>
        </div>
    );
}
