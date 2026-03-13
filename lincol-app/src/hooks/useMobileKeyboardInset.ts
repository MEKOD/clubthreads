import { useEffect, useState } from 'react';

export function useMobileKeyboardInset(active = true) {
    const [keyboardInset, setKeyboardInset] = useState(0);

    useEffect(() => {
        if (!active) {
            setKeyboardInset(0);
            return;
        }

        const viewport = window.visualViewport;
        if (!viewport) {
            return;
        }

        const updateKeyboardInset = () => {
            if (window.matchMedia('(min-width: 768px)').matches) {
                setKeyboardInset(0);
                return;
            }

            const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
            const nextInset = Math.max(0, layoutHeight - viewport.height - viewport.offsetTop);
            setKeyboardInset(nextInset > 120 ? nextInset : 0);
        };

        updateKeyboardInset();

        viewport.addEventListener('resize', updateKeyboardInset);
        viewport.addEventListener('scroll', updateKeyboardInset);
        window.addEventListener('orientationchange', updateKeyboardInset);

        return () => {
            viewport.removeEventListener('resize', updateKeyboardInset);
            viewport.removeEventListener('scroll', updateKeyboardInset);
            window.removeEventListener('orientationchange', updateKeyboardInset);
        };
    }, [active]);

    return keyboardInset;
}
