import { useState, useEffect, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';

interface KlipyGif {
    id: string;
    title: string;
    media_formats: {
        gif: { url: string; dims: [number, number] };
        nanogif: { url: string; dims: [number, number] };
    };
}

interface GifPickerProps {
    onSelect: (url: string) => void;
    onClose: () => void;
}

const KLIPY_API_KEY = import.meta.env.VITE_KLIPY_API_KEY?.trim() || '';

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
    const [query, setQuery] = useState('');
    const [gifs, setGifs] = useState<KlipyGif[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Debounce search
    const fetchGifs = useCallback(async (searchQuery: string) => {
        setIsLoading(true);
        setError(null);
        try {
            if (!KLIPY_API_KEY) {
                setGifs([]);
                setError('GIF aramasi bu build icin kapali');
                return;
            }

            const apiQuery = searchQuery.trim() || 'trending';
            const response = await fetch(`https://api.klipy.co/v2/search?q=${encodeURIComponent(apiQuery)}&api_key=${KLIPY_API_KEY}&limit=20`);

            if (!response.ok) {
                throw new Error('GIFs yüklenemedi');
            }

            const data = await response.json();
            setGifs(data.results || []);
        } catch (err) {
            console.error(err);
            setError('GIF aramasında bir hata oluştu');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            fetchGifs(query);
        }, 400);

        return () => clearTimeout(timeoutId);
    }, [query, fetchGifs]);

    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-bg-primary md:bg-overlay md:items-center md:justify-center md:p-4" onClick={onClose}>
            <div
                className="flex flex-col h-full w-full bg-bg-primary md:h-[600px] md:max-h-[90vh] md:w-[500px] md:rounded-3xl md:shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                        <input
                            autoFocus
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="GIF ara..."
                            className="w-full rounded-full bg-bg-tertiary py-2 pl-10 pr-4 text-[15px] outline-none placeholder:text-text-muted text-text-primary"
                        />
                    </div>
                    <button onClick={onClose} className="rounded-full p-2 hover:bg-bg-tertiary transition-colors -mr-2">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="native-sheet-scroll flex-1 overflow-y-auto bg-bg-secondary p-2">
                    {isLoading && gifs.length === 0 ? (
                        <div className="flex h-full items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                        </div>
                    ) : error ? (
                        <div className="flex h-full items-center justify-center text-sm text-[#e84233]">
                            {error}
                        </div>
                    ) : gifs.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-text-muted">
                            Sonuç bulunamadı
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2 pb-20 md:pb-0 auto-rows-[120px]">
                            {gifs.map((gif) => (
                                <button
                                    key={gif.id}
                                    onClick={() => onSelect(gif.media_formats.gif.url)}
                                    className="relative overflow-hidden rounded-xl bg-bg-secondary group transition-transform active:scale-95"
                                >
                                    <img
                                        src={gif.media_formats.nanogif?.url || gif.media_formats.gif.url}
                                        alt={gif.title}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                    />
                                    <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
