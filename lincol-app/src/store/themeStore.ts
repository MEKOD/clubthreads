import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeType = 'light' | 'dark' | 'system';

interface ThemeState {
    theme: ThemeType;
    setTheme: (theme: ThemeType) => void;
}

export const useThemeStore = create<ThemeState>()(
    persist(
        (set) => ({
            theme: 'system',
            setTheme: (theme) => set({ theme }),
        }),
        {
            name: 'club-threads-theme',
        }
    )
);

function updateMetaTag(name: string, content: string) {
    const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (meta) {
        meta.setAttribute('content', content);
        return;
    }

    const created = document.createElement('meta');
    created.name = name;
    created.content = content;
    document.head.appendChild(created);
}

export function applyTheme(theme: ThemeType) {
    const isDark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.style.colorScheme = 'dark';
    } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.style.colorScheme = 'light';
    }

    updateMetaTag('theme-color', isDark ? '#000000' : '#ffffff');
    updateMetaTag('apple-mobile-web-app-status-bar-style', isDark ? 'black' : 'default');
}
