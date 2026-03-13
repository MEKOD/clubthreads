import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getAvatarUrl } from '../../../lib/axios';
import type { DirectConversationSummary } from '../../../lib/social';
import { VerifiedBadge } from '../../../components/ui/VerifiedBadge';

interface MessagesThreadHeaderProps {
    activeConversation: DirectConversationSummary | null;
    counterpartyTyping: boolean;
    syncingLatest: boolean;
    onBack: () => void;
    onOpenProfile: (username: string) => void;
}

export function MessagesThreadHeader({
    activeConversation,
    counterpartyTyping,
    syncingLatest,
    onBack,
    onOpenProfile,
}: MessagesThreadHeaderProps) {
    const [showSyncIndicator, setShowSyncIndicator] = useState(false);

    useEffect(() => {
        if (!syncingLatest) {
            setShowSyncIndicator(false);
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setShowSyncIndicator(true);
        }, 450);

        return () => window.clearTimeout(timeoutId);
    }, [syncingLatest]);

    const subtitle = activeConversation
        ? counterpartyTyping
            ? 'yaziyor...'
            : activeConversation.canMessage
                ? activeConversation.otherBio || 'Cevap vermeye hazir'
                : 'Salt okunur gecmis'
        : 'Sohbet aciliyor...';

    return (
        <div className="border-b border-[#6e503f] bg-[#7f5c49] px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.55rem)] text-white shadow-[0_6px_18px_rgba(96,68,52,0.22)] dark:border-[#1b1f27] dark:bg-[#101218] dark:shadow-[0_8px_20px_rgba(0,0,0,0.4)] md:px-4 md:py-2.5">
            <div className="flex items-center gap-2.5 md:gap-3">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-white/92 transition hover:bg-white/10 md:hidden"
                    aria-label="Mesaj listesine don"
                >
                    <ArrowLeft size={17} />
                </button>

                {activeConversation ? (
                    <button
                        type="button"
                        onClick={() => onOpenProfile(activeConversation.otherUsername)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-[18px] bg-white/8 px-2 py-1.5 text-left transition hover:bg-white/12 dark:bg-white/[0.04] dark:hover:bg-white/[0.07] md:px-2.5 md:py-2"
                    >
                        <img
                            src={getAvatarUrl(activeConversation.otherUsername, activeConversation.otherProfilePic)}
                            alt={activeConversation.otherUsername}
                            className="h-10 w-10 rounded-full object-cover ring-2 ring-white/12 md:h-11 md:w-11"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <div className="truncate text-[16px] font-semibold text-white">
                                    @{activeConversation.otherUsername}
                                </div>
                                <VerifiedBadge role={activeConversation.otherRole} size={16} />
                                {showSyncIndicator ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70" />
                                ) : null}
                            </div>
                            <div className={`truncate text-[12px] ${counterpartyTyping ? 'text-[#7fd7f6] dark:text-[#74a4ff]' : 'text-white/74 dark:text-white/62'}`}>
                                {subtitle}
                            </div>
                        </div>
                    </button>
                ) : (
                    <div className="text-sm text-white/72">Sohbet aciliyor...</div>
                )}
            </div>
        </div>
    );
}
