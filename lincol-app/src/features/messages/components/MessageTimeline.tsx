import { memo, useMemo } from 'react';
import { AlertCircle, Check, CheckCheck, Loader2 } from 'lucide-react';
import { toAbsoluteUrl, toVideoPosterUrl } from '../../../lib/axios';
import { PostMedia } from '../../../components/ui/MediaLightbox';
import type { LocalDirectMessage } from '../types';
import { formatBubbleTimestamp, getMediaLabel } from '../utils';

type MessageSegment =
    | { type: 'day'; key: string; label: string }
    | { type: 'message'; key: string; item: LocalDirectMessage };

function formatDayLabel(value: string) {
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return 'Bugun';
    }

    if (date.toDateString() === yesterday.toDateString()) {
        return 'Dun';
    }

    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'short' });
}

function buildMessageSegments(messages: LocalDirectMessage[]): MessageSegment[] {
    const segments: MessageSegment[] = [];
    let currentDayKey = '';

    for (const message of messages) {
        const date = new Date(message.createdAt);
        const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

        if (dayKey !== currentDayKey) {
            currentDayKey = dayKey;
            segments.push({
                type: 'day',
                key: `day-${dayKey}`,
                label: formatDayLabel(message.createdAt),
            });
        }

        segments.push({
            type: 'message',
            key: message.localId ?? message.clientMessageId ?? message.id,
            item: message,
        });
    }

    return segments;
}

interface MessageTimelineProps {
    messages: LocalDirectMessage[];
    currentUserId?: string;
    seenSequence: number;
    deliveredSequence: number;
    counterpartyTyping: boolean;
    canMessage: boolean;
}

function MessageStatus({
    state,
}: {
    state: 'failed' | 'sending' | 'seen' | 'delivered' | 'sent';
}) {
    if (state === 'failed') {
        return <AlertCircle className="h-3.5 w-3.5 text-[#f15c6d]" />;
    }

    if (state === 'sending') {
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-[#6f655f] dark:text-[#9ca3b3]" />;
    }

    if (state === 'seen') {
        return <CheckCheck className="h-3.5 w-3.5 text-[#7bd6ff] dark:text-[#83acff]" />;
    }

    if (state === 'delivered') {
        return <CheckCheck className="h-3.5 w-3.5 text-[#6f655f] dark:text-[#9ca3b3]" />;
    }

    return <Check className="h-3.5 w-3.5 text-[#6f655f] dark:text-[#9ca3b3]" />;
}

export const MessageTimeline = memo(function MessageTimeline({
    messages,
    currentUserId,
    seenSequence,
    deliveredSequence,
    counterpartyTyping,
    canMessage,
}: MessageTimelineProps) {
    const messageSegments = useMemo(() => buildMessageSegments(messages), [messages]);

    if (messageSegments.length === 0) {
        return (
            <div className="mx-auto mt-10 max-w-md rounded-[24px] border border-[#ddcec2] bg-[#fffaf7]/92 px-6 py-8 text-center shadow-[0_12px_28px_rgba(70,46,31,0.08)] backdrop-blur-sm dark:border-[#1b1f27] dark:bg-[#0d0f14]/92 dark:shadow-none">
                <div className="text-[24px] font-black tracking-[-0.03em] text-[#2f2823] dark:text-[#f1f3f7]">
                    Ilk mesaji at
                </div>
                <p className="mt-3 text-sm leading-7 text-[#7c6657] dark:text-[#8c93a3]">
                    Sohbeti baslatmak icin ilk mesaji gonder.
                </p>
            </div>
        );
    }

    return (
        <>
            {messageSegments.map((segment) => {
                if (segment.type === 'day') {
                    return (
                        <div key={segment.key} className="flex justify-center py-1.5">
                            <div className="rounded-full border border-[#ddcec2] bg-[#fffaf7]/84 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7c6657] shadow-[0_4px_12px_rgba(70,46,31,0.04)] backdrop-blur-sm dark:border-[#1b1f27] dark:bg-[#0d0f14]/82 dark:text-[#8c93a3] dark:shadow-none">
                                {segment.label}
                            </div>
                        </div>
                    );
                }

                const message = segment.item;
                const isOwn = message.senderId === currentUserId;
                const messageMediaUrl = message.mediaUrl?.startsWith('blob:')
                    ? message.mediaUrl
                    : toAbsoluteUrl(message.mediaUrl);
                const isVideoMessage = message.mediaMimeType?.startsWith('video/');
                const messagePosterUrl = isVideoMessage
                    ? message.mediaUrl?.startsWith('blob:')
                        ? undefined
                        : toVideoPosterUrl(message.mediaUrl) ?? undefined
                    : undefined;
                const messageState = message.status === 'failed'
                    ? 'failed'
                    : message.status === 'sending'
                        ? 'sending'
                        : typeof message.sequence === 'number' && message.sequence <= seenSequence
                            ? 'seen'
                            : typeof message.sequence === 'number' && message.sequence <= deliveredSequence
                                ? 'delivered'
                                : 'sent';

                return (
                    <div key={segment.key} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[82%]">
                            <div
                                className={`overflow-hidden rounded-[18px] px-3.5 py-2.5 text-[14px] leading-6 shadow-[0_1px_0_rgba(17,27,33,0.08),0_8px_18px_rgba(17,27,33,0.04)] transition dark:shadow-none ${
                                    isOwn
                                        ? 'rounded-tr-[6px] bg-[#45a9cf] text-white shadow-[0_6px_16px_rgba(69,169,207,0.18)] dark:bg-[#356cff] dark:text-white dark:shadow-[0_10px_24px_rgba(53,108,255,0.22)]'
                                        : 'rounded-tl-[6px] bg-[#fffaf7] text-[#2f2823] shadow-[0_1px_0_rgba(70,46,31,0.08),0_8px_18px_rgba(70,46,31,0.04)] dark:bg-[#2c2f36] dark:text-[#f1f3f7]'
                                } ${message.status === 'sending' ? 'opacity-80' : ''} ${message.status === 'failed' ? 'ring-2 ring-[#f15c6d]/60' : ''}`}
                            >
                                {messageMediaUrl ? (
                                    <div className={message.content ? '-mt-1' : '-mt-2'}>
                                        <PostMedia
                                            src={messageMediaUrl}
                                            isVideo={Boolean(isVideoMessage)}
                                            posterSrc={messagePosterUrl}
                                            alt={getMediaLabel(message.mediaMimeType)}
                                            compact
                                        />
                                    </div>
                                ) : null}

                                {message.content ? (
                                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                                ) : message.isEncrypted && !messageMediaUrl ? (
                                    <p className="whitespace-pre-wrap break-words opacity-80">Sifreli mesaj</p>
                                ) : null}

                                <div className={`mt-1.5 flex items-end gap-1 text-[11px] ${
                                    isOwn
                                        ? 'justify-end text-white/88 dark:text-white/88'
                                        : 'justify-end text-[#7c6657] dark:text-[#9ca3b3]'
                                }`}>
                                    <span>{formatBubbleTimestamp(message.createdAt)}</span>
                                    {isOwn ? <MessageStatus state={messageState} /> : null}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}

            {counterpartyTyping && canMessage ? (
                <div className="flex justify-start">
                    <div className="flex items-center gap-1.5 rounded-[18px] rounded-tl-[6px] bg-[#fffaf7] px-4 py-3 shadow-[0_1px_0_rgba(70,46,31,0.08),0_8px_18px_rgba(70,46,31,0.04)] dark:bg-[#2c2f36] dark:shadow-none">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[#9b8a7f] dark:bg-[#a2aab8] [animation-delay:-0.2s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[#9b8a7f] dark:bg-[#a2aab8] [animation-delay:-0.1s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[#9b8a7f] dark:bg-[#a2aab8]" />
                    </div>
                </div>
            ) : null}

            <div className="h-px" style={{ overflowAnchor: 'auto' }} />
        </>
    );
});
