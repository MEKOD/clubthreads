import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

const LazyGifPicker = lazy(async () => {
    const module = await import('./GifPicker');
    return { default: module.GifPicker };
});

interface DeferredGifPickerProps {
    onSelect: (url: string) => void;
    onClose: () => void;
}

export function DeferredGifPicker(props: DeferredGifPickerProps) {
    useBodyScrollLock(true);

    return (
        <Suspense fallback={(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20">
                <Loader2 className="h-6 w-6 animate-spin text-inverse-primary" />
            </div>
        )}>
            <LazyGifPicker {...props} />
        </Suspense>
    );
}
