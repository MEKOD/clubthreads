import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CommunityState {
    lastVisitedCommunitySlug: string | null;
    membershipVersion: number;
    setLastVisitedCommunitySlug: (slug: string | null) => void;
    clearLastVisitedCommunitySlug: () => void;
    bumpMembershipVersion: () => void;
}

export const useCommunityStore = create<CommunityState>()(
    persist(
        (set) => ({
            lastVisitedCommunitySlug: null,
            membershipVersion: 0,
            setLastVisitedCommunitySlug: (slug) => set({ lastVisitedCommunitySlug: slug }),
            clearLastVisitedCommunitySlug: () => set({ lastVisitedCommunitySlug: null }),
            bumpMembershipVersion: () => set((state) => ({ membershipVersion: state.membershipVersion + 1 })),
        }),
        {
            name: 'lincol-community-storage',
        }
    )
);
