import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type ChangeEvent,
    type FocusEvent,
    type KeyboardEvent,
    type TextareaHTMLAttributes,
} from 'react';
import { Loader2 } from 'lucide-react';
import { api, getAvatarUrl } from '../../lib/axios';

interface MentionCandidate {
    id: string;
    username: string;
    profilePic: string | null;
    bio?: string | null;
}

interface ActiveMention {
    start: number;
    end: number;
    query: string;
}

interface MentionTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
    value: string;
    onValueChange: (value: string) => void;
    onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
    containerClassName?: string;
}

const MENTION_MATCH_REGEX = /(^|[\s([{"'`])@([a-zA-Z0-9._-]{0,30})$/;

function resolveActiveMention(value: string, caretPosition: number): ActiveMention | null {
    const safeCaret = Math.max(0, Math.min(caretPosition, value.length));
    const textBeforeCaret = value.slice(0, safeCaret);
    const match = textBeforeCaret.match(MENTION_MATCH_REGEX);

    if (!match) {
        return null;
    }

    const query = match[2] ?? '';
    return {
        start: safeCaret - query.length - 1,
        end: safeCaret,
        query,
    };
}

export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(function MentionTextarea(
    {
        value,
        onValueChange,
        onChange,
        onKeyDown,
        onClick,
        onKeyUp,
        onSelect,
        onFocus,
        onBlur,
        containerClassName = '',
        className = '',
        ...textareaProps
    },
    forwardedRef
) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const blurTimeoutRef = useRef<number | null>(null);
    const requestSeqRef = useRef(0);

    const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
    const [suggestions, setSuggestions] = useState<MentionCandidate[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);

    useImperativeHandle(forwardedRef, () => textareaRef.current!, []);

    const syncActiveMention = useCallback((nextValue: string, explicitCaret?: number | null) => {
        const textarea = textareaRef.current;
        const caretPosition = explicitCaret ?? textarea?.selectionStart ?? nextValue.length;
        const nextMention = resolveActiveMention(nextValue, caretPosition);
        setActiveMention(nextMention);
        setHighlightedIndex(0);
    }, []);

    useEffect(() => {
        const query = activeMention?.query.trim() ?? '';
        if (!activeMention || query.length === 0) {
            setSuggestions([]);
            setIsLoading(false);
            return;
        }

        const nextRequestId = requestSeqRef.current + 1;
        requestSeqRef.current = nextRequestId;
        setIsLoading(true);

        const timeoutId = window.setTimeout(async () => {
            try {
                const response = await api.get(`/search/users?q=${encodeURIComponent(query)}`);
                if (requestSeqRef.current !== nextRequestId) {
                    return;
                }
                setSuggestions((response.data.users ?? []).slice(0, 6));
            } catch (error) {
                if (requestSeqRef.current === nextRequestId) {
                    setSuggestions([]);
                }
                console.error('Mention search failed', error);
            } finally {
                if (requestSeqRef.current === nextRequestId) {
                    setIsLoading(false);
                }
            }
        }, 120);

        return () => window.clearTimeout(timeoutId);
    }, [activeMention]);

    useEffect(() => {
        return () => {
            if (blurTimeoutRef.current !== null) {
                window.clearTimeout(blurTimeoutRef.current);
            }
        };
    }, []);

    const applySuggestion = useCallback((candidate: MentionCandidate) => {
        if (!activeMention) {
            return;
        }

        const nextValue = `${value.slice(0, activeMention.start)}@${candidate.username} ${value.slice(activeMention.end)}`;
        const nextCaretPosition = activeMention.start + candidate.username.length + 2;

        onValueChange(nextValue);
        setSuggestions([]);
        setActiveMention(null);
        setHighlightedIndex(0);

        requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) {
                return;
            }
            textarea.focus();
            textarea.setSelectionRange(nextCaretPosition, nextCaretPosition);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }, [activeMention, onValueChange, value]);

    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        onValueChange(event.target.value);
        syncActiveMention(event.target.value, event.target.selectionStart);
        onChange?.(event);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        const hasSuggestionList = activeMention?.query.length && (suggestions.length > 0 || isLoading);

        if (hasSuggestionList) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (suggestions.length > 0) {
                    setHighlightedIndex((current) => (current + 1) % suggestions.length);
                }
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (suggestions.length > 0) {
                    setHighlightedIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
                }
                return;
            }

            if ((event.key === 'Enter' || event.key === 'Tab') && suggestions.length > 0) {
                event.preventDefault();
                applySuggestion(suggestions[highlightedIndex] ?? suggestions[0]);
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                setSuggestions([]);
                setActiveMention(null);
                setHighlightedIndex(0);
                return;
            }
        }

        onKeyDown?.(event);
    };

    const handleSelectionLikeEvent = () => {
        syncActiveMention(value);
    };

    const handleBlur = (event: FocusEvent<HTMLTextAreaElement>) => {
        blurTimeoutRef.current = window.setTimeout(() => {
            setSuggestions([]);
            setActiveMention(null);
            setHighlightedIndex(0);
        }, 120);
        onBlur?.(event);
    };

    const handleFocus = (event: FocusEvent<HTMLTextAreaElement>) => {
        syncActiveMention(value);
        onFocus?.(event);
    };

    return (
        <div className={`relative ${containerClassName}`}>
            <textarea
                {...textareaProps}
                ref={textareaRef}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onClick={(event) => {
                    handleSelectionLikeEvent();
                    onClick?.(event);
                }}
                onKeyUp={(event) => {
                    handleSelectionLikeEvent();
                    onKeyUp?.(event);
                }}
                onSelect={(event) => {
                    handleSelectionLikeEvent();
                    onSelect?.(event);
                }}
                onFocus={handleFocus}
                onBlur={handleBlur}
                className={className}
            />

            {activeMention?.query.length ? (
                <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-border-subtle bg-bg-primary shadow-[0_18px_42px_rgba(17,17,17,0.14)]">
                    {isLoading ? (
                        <div className="flex items-center gap-2 px-3 py-3 text-sm text-text-secondary">
                            <Loader2 size={15} className="animate-spin" />
                            Kullanicilar aranıyor...
                        </div>
                    ) : suggestions.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-text-secondary">
                            Eslesen kullanici yok.
                        </div>
                    ) : (
                        <div className="py-1">
                            {suggestions.map((candidate, index) => (
                                <button
                                    key={candidate.id}
                                    type="button"
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        applySuggestion(candidate);
                                    }}
                                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${index === highlightedIndex ? 'bg-bg-secondary' : 'hover:bg-bg-secondary/70'}`}
                                >
                                    <div className="h-9 w-9 overflow-hidden rounded-full bg-bg-secondary">
                                        <img src={getAvatarUrl(candidate.username, candidate.profilePic)} alt={candidate.username} className="h-full w-full object-cover" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-text-primary">@{candidate.username}</div>
                                        {candidate.bio ? (
                                            <div className="mt-0.5 line-clamp-1 text-xs text-text-muted">{candidate.bio}</div>
                                        ) : (
                                            <div className="mt-0.5 text-xs text-text-muted">Mention olarak ekle</div>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
});
