import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// Use environment variable, fallback to localhost for dev
export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_ORIGIN = (() => {
    try {
        return new URL(API_URL).origin;
    } catch {
        return API_URL;
    }
})();

export const api = axios.create({
    baseURL: API_URL,
});

// Request Interceptor: Attach JWT Token
api.interceptors.request.use(
    (config) => {
        const token = useAuthStore.getState().token;
        if (token && config.headers) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response Interceptor: Handle 401 Unauthorized globally
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const requestUrl = String(error.config?.url || '');
        const isAuthScreenRequest =
            requestUrl.includes('/auth/login') || requestUrl.includes('/auth/register');

        if (error.response?.status === 401 && !isAuthScreenRequest) {
            useAuthStore.getState().logout();
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export function toAbsoluteUrl(url?: string | null) {
    if (!url) {
        return null;
    }

    const cleanedUrl = url.trim();
    const tryCloudflareMatch = cleanedUrl
        .replace(/^https?:\/\//i, '')
        .replace(/^\/\//, '')
        .match(/^([^/]*trycloudflare\.com)(\/.*)?$/i);

    if (tryCloudflareMatch) {
        return `${API_ORIGIN}${tryCloudflareMatch[2] ?? ''}`;
    }

    if (cleanedUrl.startsWith('//')) {
        return `https:${cleanedUrl}`;
    }

    if (/^https?:\/\//i.test(cleanedUrl)) {
        try {
            const parsed = new URL(cleanedUrl);
            if (parsed.hostname.endsWith('trycloudflare.com')) {
                return `${API_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }
            return cleanedUrl;
        } catch {
            return cleanedUrl;
        }
    }

    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(cleanedUrl)) {
        return `https://${cleanedUrl}`;
    }

    if (!cleanedUrl.startsWith('/') && /\.(webp|png|jpe?g|gif|mp4|mov|webm)$/i.test(cleanedUrl)) {
        return `${API_URL}/media/${cleanedUrl}`;
    }

    return `${API_URL}${cleanedUrl.startsWith('/') ? '' : '/'}${cleanedUrl}`;
}

export function toVideoPosterUrl(url?: string | null) {
    const absoluteUrl = toAbsoluteUrl(url);
    if (!absoluteUrl) {
        return null;
    }

    return absoluteUrl.replace(/_opt\.mp4(\?.*)?$/i, '_poster.png$1');
}

export function getAvatarUrl(username?: string, profilePic?: string | null) {
    return (
        toAbsoluteUrl(profilePic) ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${username || 'user'}&backgroundColor=f0f0f0`
    );
}
