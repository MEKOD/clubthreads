import { useEffect, useRef, useState } from 'react';

declare global {
    interface Window {
        turnstile?: {
            render: (container: HTMLElement, options: {
                sitekey: string;
                callback: (token: string) => void;
                'expired-callback': () => void;
                'error-callback': () => void;
                theme?: 'light' | 'dark' | 'auto';
            }) => string;
            reset: (widgetId?: string) => void;
            remove: (widgetId?: string) => void;
        };
    }
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function ensureTurnstileScript() {
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
        return existing;
    }

    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
    return script;
}

interface TurnstileWidgetProps {
    onTokenChange: (token: string) => void;
    onError?: (message: string) => void;
}

export function TurnstileWidget({ onTokenChange, onError }: TurnstileWidgetProps) {
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || '';
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (!siteKey) {
            return;
        }

        const script = ensureTurnstileScript();
        const handleLoad = () => setIsLoaded(true);

        if (window.turnstile) {
            setIsLoaded(true);
        } else {
            script.addEventListener('load', handleLoad);
        }

        return () => {
            script.removeEventListener('load', handleLoad);
        };
    }, [siteKey]);

    useEffect(() => {
        if (!siteKey || !isLoaded || !window.turnstile || !containerRef.current || widgetIdRef.current) {
            return;
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme: 'auto',
            callback: (token) => {
                onTokenChange(token);
                onError?.('');
            },
            'expired-callback': () => {
                onTokenChange('');
                onError?.('Captcha suresi doldu. Tekrar dogrula.');
                if (widgetIdRef.current) {
                    window.turnstile?.reset(widgetIdRef.current);
                }
            },
            'error-callback': () => {
                onTokenChange('');
                onError?.('Captcha yuklenemedi. Tekrar dene.');
            },
        });

        return () => {
            if (widgetIdRef.current) {
                window.turnstile?.remove(widgetIdRef.current);
                widgetIdRef.current = null;
            }
        };
    }, [isLoaded, onError, onTokenChange, siteKey]);

    if (!siteKey) {
        return null;
    }

    return <div ref={containerRef} className="min-h-[65px]" />;
}
