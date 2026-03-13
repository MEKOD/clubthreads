import { useEffect } from 'react';

interface ScrollLockSnapshot {
    bodyOverflow: string;
    bodyPosition: string;
    bodyTop: string;
    bodyLeft: string;
    bodyRight: string;
    bodyWidth: string;
    bodyPaddingRight: string;
    bodyTouchAction: string;
    documentOverflow: string;
    documentOverscrollBehavior: string;
    scrollX: number;
    scrollY: number;
}

declare global {
    interface Window {
        __ctBodyScrollLockCount?: number;
        __ctBodyScrollLockSnapshot?: ScrollLockSnapshot;
    }
}

export function useBodyScrollLock(locked: boolean) {
    useEffect(() => {
        if (!locked || typeof window === 'undefined') {
            return;
        }

        const { body, documentElement } = document;
        const currentLockCount = window.__ctBodyScrollLockCount ?? 0;

        if (currentLockCount === 0) {
            const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth);
            window.__ctBodyScrollLockSnapshot = {
                bodyOverflow: body.style.overflow,
                bodyPosition: body.style.position,
                bodyTop: body.style.top,
                bodyLeft: body.style.left,
                bodyRight: body.style.right,
                bodyWidth: body.style.width,
                bodyPaddingRight: body.style.paddingRight,
                bodyTouchAction: body.style.touchAction,
                documentOverflow: documentElement.style.overflow,
                documentOverscrollBehavior: documentElement.style.overscrollBehavior,
                scrollX: window.scrollX,
                scrollY: window.scrollY,
            };

            body.style.overflow = 'hidden';
            body.style.position = 'fixed';
            body.style.top = `-${window.scrollY}px`;
            body.style.left = '0';
            body.style.right = '0';
            body.style.width = '100%';
            body.style.touchAction = 'none';

            if (scrollbarWidth > 0) {
                const basePaddingRight = body.style.paddingRight || '0px';
                body.style.paddingRight = `calc(${basePaddingRight} + ${scrollbarWidth}px)`;
            }

            documentElement.style.overflow = 'hidden';
            documentElement.style.overscrollBehavior = 'none';
            body.setAttribute('data-scroll-locked', 'true');
        }

        window.__ctBodyScrollLockCount = currentLockCount + 1;

        return () => {
            const nextLockCount = Math.max((window.__ctBodyScrollLockCount ?? 1) - 1, 0);

            if (nextLockCount === 0) {
                const snapshot = window.__ctBodyScrollLockSnapshot;

                body.style.overflow = snapshot?.bodyOverflow ?? '';
                body.style.position = snapshot?.bodyPosition ?? '';
                body.style.top = snapshot?.bodyTop ?? '';
                body.style.left = snapshot?.bodyLeft ?? '';
                body.style.right = snapshot?.bodyRight ?? '';
                body.style.width = snapshot?.bodyWidth ?? '';
                body.style.paddingRight = snapshot?.bodyPaddingRight ?? '';
                body.style.touchAction = snapshot?.bodyTouchAction ?? '';

                documentElement.style.overflow = snapshot?.documentOverflow ?? '';
                documentElement.style.overscrollBehavior = snapshot?.documentOverscrollBehavior ?? '';
                body.removeAttribute('data-scroll-locked');

                delete window.__ctBodyScrollLockCount;
                delete window.__ctBodyScrollLockSnapshot;

                if (snapshot) {
                    window.scrollTo({
                        left: snapshot.scrollX,
                        top: snapshot.scrollY,
                        behavior: 'auto',
                    });
                }

                return;
            }

            window.__ctBodyScrollLockCount = nextLockCount;
        };
    }, [locked]);
}
