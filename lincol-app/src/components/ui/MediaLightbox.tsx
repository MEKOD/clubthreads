import { useEffect, useRef, useState } from 'react';
import { X, Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface MediaLightboxProps {
    src: string;
    type: 'image' | 'video';
    alt?: string;
    onClose: () => void;
}

export function MediaLightbox({ src, type, alt, onClose }: MediaLightboxProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentTime, setCurrentTime] = useState('0:00');
    const [duration, setDuration] = useState('0:00');

    useBodyScrollLock(true);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('keydown', handleKey);
        };
    }, [onClose]);

    const formatTime = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleTimeUpdate = () => {
        const v = videoRef.current;
        if (!v) return;
        setProgress((v.currentTime / v.duration) * 100);
        setCurrentTime(formatTime(v.currentTime));
    };

    const handleLoadedMetadata = () => {
        const v = videoRef.current;
        if (!v) return;
        setDuration(formatTime(v.duration));
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        const v = videoRef.current;
        if (!v) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        v.currentTime = ratio * v.duration;
    };

    const togglePlay = () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
            v.play();
            setIsPlaying(true);
        } else {
            v.pause();
            setIsPlaying(false);
        }
    };

    const toggleMute = () => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setIsMuted(v.muted);
    };

    const handleFullscreen = () => {
        videoRef.current?.requestFullscreen?.();
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
            onClick={onClose}
        >
            {/* Close button */}
            <button
                onClick={onClose}
                className="absolute left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-inverse-primary transition hover:bg-black/80"
            >
                <X size={20} />
            </button>

            {type === 'image' ? (
                <img
                    src={src}
                    alt={alt || 'Medya'}
                    onClick={(e) => e.stopPropagation()}
                    className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain select-none"
                    draggable={false}
                />
            ) : (
                <div
                    onClick={(e) => e.stopPropagation()}
                    className="relative w-full max-w-3xl"
                >
                    <video
                        ref={videoRef}
                        src={src}
                        className="max-h-[85vh] w-full rounded-lg bg-text-primary object-contain"
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleLoadedMetadata}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                        onClick={togglePlay}
                        autoPlay
                        playsInline
                    />

                    {/* Custom controls overlay */}
                    <div className="absolute inset-x-0 bottom-0 rounded-b-lg bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-10">
                        {/* Progress bar */}
                        <div
                            onClick={handleSeek}
                            className="group mb-3 h-1 w-full cursor-pointer rounded-full bg-bg-primary/30 transition-all hover:h-1.5"
                        >
                            <div
                                className="h-full rounded-full bg-bg-primary transition-all"
                                style={{ width: `${progress}%` }}
                            />
                        </div>

                        <div className="flex items-center justify-between text-inverse-primary">
                            <div className="flex items-center gap-3">
                                <button onClick={togglePlay} className="transition hover:scale-110">
                                    {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
                                </button>

                                <button onClick={toggleMute} className="transition hover:scale-110">
                                    {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                                </button>

                                <span className="text-[13px] tabular-nums text-inverse-primary/80">
                                    {currentTime} / {duration}
                                </span>
                            </div>

                            <button onClick={handleFullscreen} className="transition hover:scale-110">
                                <Maximize size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── Inline Media Component for Feed ─────────────────────────────────────── */

interface PostMediaProps {
    src: string;
    isVideo: boolean;
    posterSrc?: string;
    alt?: string;
    compact?: boolean;
}

export function PostMedia({ src, isVideo, posterSrc, alt, compact }: PostMediaProps) {
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [videoPlaying, setVideoPlaying] = useState(false);
    const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const videoSrc = isVideo && !src.includes('#t=') ? `${src}#t=0.001` : src;

    useEffect(() => {
        if (!isVideo) {
            return;
        }
        const video = videoRef.current; // Capture videoRef.current here

        return () => {
            if (video) { // Use the captured video variable
                video.pause();
                video.removeAttribute('src');
                video.load();
            }
        };
    }, [isVideo]);

    useEffect(() => {
        if (!isVideo || shouldLoadVideo) {
            return;
        }

        const element = containerRef.current;
        if (!element) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    setShouldLoadVideo(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '220px' }
        );

        observer.observe(element);
        return () => observer.disconnect();
    }, [isVideo, shouldLoadVideo]);

    if (isVideo) {
        return (
            <>
                <div
                    ref={containerRef}
                    className={`relative cursor-pointer overflow-hidden rounded-2xl border border-border bg-text-primary ${compact ? 'mt-2' : 'mt-3'}`}
                    style={{ maxHeight: '512px' }}
                >
                    <video
                        ref={videoRef}
                        src={shouldLoadVideo ? videoSrc : undefined}
                        poster={posterSrc}
                        className="max-h-[512px] w-full object-contain"
                        playsInline
                        muted={false}
                        preload={shouldLoadVideo ? 'auto' : 'none'}
                        controls={videoPlaying}
                        onClick={(e) => {
                            e.stopPropagation();
                        }}
                        onPlay={() => setVideoPlaying(true)}
                        onPause={() => setVideoPlaying(false)}
                        onEnded={() => setVideoPlaying(false)}
                    />

                    {/* Play overlay */}
                    {!videoPlaying && (
                        <div
                            className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/8 via-transparent to-black/12"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setShouldLoadVideo(true);
                                setVideoPlaying(true);
                                requestAnimationFrame(() => {
                                    void videoRef.current?.play().catch(() => {
                                        setVideoPlaying(false);
                                    });
                                });
                            }}
                        >
                            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/18 bg-black/72 text-white shadow-[0_12px_30px_rgba(0,0,0,0.38)] backdrop-blur-md transition hover:scale-105 hover:bg-black/84">
                                <Play size={30} fill="currentColor" className="ml-1 drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]" />
                            </div>
                        </div>
                    )}
                </div>
            </>
        );
    }

    return (
        <>
            <div
                className={`cursor-pointer overflow-hidden rounded-2xl border border-border ${compact ? 'mt-2' : 'mt-3'}`}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setLightboxOpen(true);
                }}
            >
                <img
                    src={src}
                    alt={alt || 'Post medya'}
                    className="max-h-[512px] w-full object-cover transition duration-200 hover:brightness-[0.92]"
                    loading="lazy"
                />
            </div>

            {lightboxOpen && (
                <MediaLightbox
                    src={src}
                    type="image"
                    alt={alt}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </>
    );
}
