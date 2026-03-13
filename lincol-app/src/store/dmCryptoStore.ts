import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DmCryptoState {
    hydrated: boolean;
    ownerUserId: string | null;
    publicKey: JsonWebKey | null;
    privateKey: JsonWebKey | null;
    setHydrated: (hydrated: boolean) => void;
    setKeyPair: (ownerUserId: string, publicKey: JsonWebKey, privateKey: JsonWebKey) => void;
    clear: () => void;
}

export const useDmCryptoStore = create<DmCryptoState>()(
    persist(
        (set) => ({
            hydrated: false,
            ownerUserId: null,
            publicKey: null,
            privateKey: null,
            setHydrated: (hydrated) => set({ hydrated }),
            setKeyPair: (ownerUserId, publicKey, privateKey) => set({ ownerUserId, publicKey, privateKey }),
            clear: () => set({ ownerUserId: null, publicKey: null, privateKey: null }),
        }),
        {
            name: 'lincol-dm-crypto-storage',
            onRehydrateStorage: () => (state) => {
                state?.setHydrated(true);
            },
        }
    )
);
