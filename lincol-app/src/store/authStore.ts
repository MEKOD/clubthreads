import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useDmCryptoStore } from './dmCryptoStore';

export interface User {
    id: string;
    username: string;
    handle: string;
    role: 'user' | 'pink' | 'elite' | 'admin';
    profilePic?: string | null;
    coverPic?: string | null;
    bio?: string | null;
    rejectCommunityInvites?: boolean;
}

interface AuthState {
    user: User | null;
    token: string | null;
    hydrated: boolean;
    setHydrated: (hydrated: boolean) => void;
    setAuth: (user: User, token: string) => void;
    updateUser: (data: Partial<User>) => void;
    logout: () => void;
    isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            user: null,
            token: null,
            hydrated: false,
            setHydrated: (hydrated) => set({ hydrated }),

            setAuth: (user, token) => set((state) => {
                if (state.user?.id && state.user.id !== user.id) {
                    useDmCryptoStore.getState().clear();
                }

                return { user, token };
            }),

            updateUser: (data) => set((state) => ({
                user: state.user ? { ...state.user, ...data } : null
            })),

            logout: () => {
                useDmCryptoStore.getState().clear();
                set({ user: null, token: null });
            },

            isAuthenticated: () => !!get().token
        }),
        {
            name: 'lincol-auth-storage',
            onRehydrateStorage: () => (state) => {
                state?.setHydrated(true);
            },
        }
    )
);
