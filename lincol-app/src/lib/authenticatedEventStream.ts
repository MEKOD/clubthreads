export type AuthenticatedEventListener = (event: MessageEvent<string>) => void;

export interface AuthenticatedEventStream {
    addEventListener: (event: string, listener: AuthenticatedEventListener) => void;
    removeEventListener: (event: string, listener: AuthenticatedEventListener) => void;
    close: () => void;
}

interface CreateAuthenticatedEventStreamOptions {
    url: string;
    token: string;
    onOpen?: () => void;
    onError?: (error: unknown) => void;
}

function dispatchEvent(
    listeners: Map<string, Set<AuthenticatedEventListener>>,
    eventName: string,
    data: string
) {
    const event = new MessageEvent<string>(eventName, { data });
    listeners.get(eventName)?.forEach((listener) => listener(event));
}

function processEventChunk(
    chunk: string,
    listeners: Map<string, Set<AuthenticatedEventListener>>
) {
    if (!chunk.trim()) {
        return;
    }

    let eventName = 'message';
    const dataLines: string[] = [];

    for (const rawLine of chunk.split('\n')) {
        const line = rawLine.trimEnd();
        if (!line || line.startsWith(':')) {
            continue;
        }

        const separatorIndex = line.indexOf(':');
        const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
        const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
        const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

        if (field === 'event' && value) {
            eventName = value;
        }

        if (field === 'data') {
            dataLines.push(value);
        }
    }

    if (dataLines.length === 0) {
        return;
    }

    dispatchEvent(listeners, eventName, dataLines.join('\n'));
}

export function createAuthenticatedEventStream(
    options: CreateAuthenticatedEventStreamOptions
): AuthenticatedEventStream {
    const listeners = new Map<string, Set<AuthenticatedEventListener>>();
    const controller = new AbortController();
    let closed = false;

    const start = async () => {
        try {
            const response = await fetch(options.url, {
                method: 'GET',
                headers: {
                    Accept: 'text/event-stream',
                    Authorization: `Bearer ${options.token}`,
                },
                cache: 'no-store',
                signal: controller.signal,
            });

            if (!response.ok || !response.body) {
                throw new Error(`Event stream request failed with status ${response.status}`);
            }

            options.onOpen?.();

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (!closed) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                buffer = buffer.replace(/\r\n/g, '\n');

                const events = buffer.split('\n\n');
                buffer = events.pop() ?? '';

                for (const eventChunk of events) {
                    processEventChunk(eventChunk, listeners);
                }
            }

            buffer += decoder.decode();
            buffer = buffer.replace(/\r\n/g, '\n');
            if (buffer) {
                processEventChunk(buffer, listeners);
            }

            if (!closed) {
                options.onError?.(new Error('Event stream closed'));
            }
        } catch (error) {
            if (closed) {
                return;
            }

            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }

            options.onError?.(error);
        }
    };

    void start();

    return {
        addEventListener(event, listener) {
            const existing = listeners.get(event) ?? new Set<AuthenticatedEventListener>();
            existing.add(listener);
            listeners.set(event, existing);
        },
        removeEventListener(event, listener) {
            listeners.get(event)?.delete(listener);
        },
        close() {
            closed = true;
            controller.abort();
            listeners.clear();
        },
    };
}
