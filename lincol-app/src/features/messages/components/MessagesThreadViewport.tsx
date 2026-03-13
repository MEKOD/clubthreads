import type { RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import type { DirectConversationSummary } from '../../../lib/social';
import type { LocalDirectMessage } from '../types';
import { MessageTimeline } from './MessageTimeline';

interface MessagesThreadViewportProps {
    viewportRef: RefObject<HTMLDivElement | null>;
    activeConversation: DirectConversationSummary | null;
    messages: LocalDirectMessage[];
    currentUserId?: string;
    counterpartyTyping: boolean;
    loadingThread: boolean;
    threadError: string | null;
    loadingOlder: boolean;
    hasMoreOlder: boolean;
    mobileComposerHeight: number;
    mobileComposerLift: number;
    onLoadOlder: () => void;
}

export function MessagesThreadViewport({
    viewportRef,
    activeConversation,
    messages,
    currentUserId,
    counterpartyTyping,
    loadingThread,
    threadError,
    loadingOlder,
    hasMoreOlder,
    mobileComposerHeight,
    mobileComposerLift,
    onLoadOlder,
}: MessagesThreadViewportProps) {
    return (
        <div
            ref={viewportRef}
            className="relative min-h-0 flex-1 overflow-y-auto bg-[#f3ebe4] px-3 pb-4 pt-3 dark:bg-[#050608] md:px-4 md:py-4"
            style={{
                paddingBottom: `${mobileComposerHeight + mobileComposerLift + 18}px`,
                overflowAnchor: 'none',
            }}
        >
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(127,92,73,0.08)_1px,transparent_0)] bg-[length:24px_24px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.035)_1px,transparent_0)]"
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.22),transparent_30%,rgba(127,92,73,0.03)_66%,transparent_100%)] dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_30%,rgba(79,134,255,0.05)_70%,transparent_100%)]"
            />

            {loadingThread ? (
                <div className="relative flex h-full items-center justify-center text-[#7c6657] dark:text-[#8c93a3]">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            ) : threadError ? (
                <div className="relative mx-auto mt-8 max-w-md rounded-[24px] border border-[#ddcec2] bg-[#fffaf7]/92 px-6 py-8 text-center shadow-[0_12px_28px_rgba(70,46,31,0.08)] backdrop-blur-sm dark:border-[#1b1f27] dark:bg-[#0d0f14]/92 dark:shadow-none">
                    <div className="text-xl font-semibold text-[#2f2823] dark:text-[#f1f3f7]">Sohbet acilamadi</div>
                    <p className="mt-2 text-sm leading-6 text-[#7c6657] dark:text-[#8c93a3]">{threadError}</p>
                </div>
            ) : (
                <div className="relative space-y-3">
                    {!activeConversation?.canMessage ? (
                        <div className="mx-auto max-w-md rounded-full border border-[#ddcec2] bg-[#fffaf7]/86 px-4 py-2 text-center text-xs font-semibold text-[#7c6657] backdrop-blur-sm dark:border-[#1b1f27] dark:bg-[#0d0f14]/82 dark:text-[#8c93a3]">
                            Yeni mesaj gondermek icin karsilikli takip yeniden kurulmali.
                        </div>
                    ) : null}

                    {loadingOlder ? (
                        <div className="flex justify-center py-1 text-[#7c6657] dark:text-[#8c93a3]">
                            <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                    ) : hasMoreOlder ? (
                        <div className="flex justify-center">
                            <button
                                type="button"
                                onClick={onLoadOlder}
                                className="rounded-full border border-[#ddcec2] bg-[#fffaf7]/90 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3a9fc8] shadow-[0_4px_12px_rgba(70,46,31,0.06)] backdrop-blur-sm dark:border-[#1b1f27] dark:bg-[#0d0f14]/85 dark:text-[#74a4ff] dark:shadow-none"
                            >
                                Daha eski mesajlar
                            </button>
                        </div>
                    ) : null}

                    <MessageTimeline
                        messages={messages}
                        currentUserId={currentUserId}
                        seenSequence={activeConversation?.otherLastSeenSequence ?? 0}
                        deliveredSequence={activeConversation?.otherLastDeliveredSequence ?? 0}
                        counterpartyTyping={counterpartyTyping}
                        canMessage={Boolean(activeConversation?.canMessage)}
                    />
                </div>
            )}
        </div>
    );
}
