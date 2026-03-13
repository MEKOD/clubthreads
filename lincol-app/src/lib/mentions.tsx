import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const CONTENT_ENTITY_REGEX = /(^|[\s([{"'`])([@/])([a-zA-Z0-9._-]+)/g;
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<]+/gi;
const TRAILING_URL_PUNCTUATION_REGEX = /[),.!?;:'"`]+$/;

function normalizeUrl(rawUrl: string) {
    return rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl;
}

function renderTextEntities(content: string, keyPrefix: string): ReactNode[] {
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    CONTENT_ENTITY_REGEX.lastIndex = 0;

    while ((match = CONTENT_ENTITY_REGEX.exec(content)) !== null) {
        const leading = match[1] ?? '';
        const marker = match[2];
        const value = match[3];
        const tokenStart = match.index + leading.length;

        if (match.index > lastIndex) {
            parts.push(content.slice(lastIndex, match.index));
        }

        if (leading) {
            parts.push(leading);
        }

        const isMention = marker === '@';
        parts.push(
            <Link
                key={`${keyPrefix}-entity-${tokenStart}`}
                to={isMention ? `/users/${value}` : `/communities/${value}`}
                onClick={(e) => e.stopPropagation()}
                className="break-words font-semibold text-text-primary hover:underline [overflow-wrap:anywhere]"
            >
                {marker}
                {value}
            </Link>
        );

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
        parts.push(content.slice(lastIndex));
    }

    return parts;
}

/**
 * Parses post content and returns React nodes with URLs, @mentions, and /community links.
 */
export function renderContentWithMentions(content: string): ReactNode[] {
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    URL_REGEX.lastIndex = 0;

    while ((match = URL_REGEX.exec(content)) !== null) {
        const rawMatch = match[0];
        const trimmedUrl = rawMatch.replace(TRAILING_URL_PUNCTUATION_REGEX, '');
        const trailingText = rawMatch.slice(trimmedUrl.length);
        if (match.index > lastIndex) {
            parts.push(...renderTextEntities(content.slice(lastIndex, match.index), `text-${lastIndex}`));
        }

        const href = normalizeUrl(trimmedUrl);
        parts.push(
            <a
                key={`url-${match.index}`}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
                className="break-words font-semibold text-brand hover:underline [overflow-wrap:anywhere]"
            >
                {trimmedUrl}
            </a>
        );

        if (trailingText) {
            parts.push(trailingText);
        }

        lastIndex = match.index + rawMatch.length;
    }

    if (lastIndex < content.length) {
        parts.push(...renderTextEntities(content.slice(lastIndex), `text-${lastIndex}`));
    }

    return parts;
}
