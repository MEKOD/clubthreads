import { type ReactNode, useEffect, useState } from 'react';
import { X, Share, Plus, MoreVertical, Download, ArrowRight, Smartphone, Check } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

type Platform = 'ios' | 'android' | 'other';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function detectPlatform(): Platform {
    const ua = navigator.userAgent || '';
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
    const isIPadOSDesktopUA = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

    if (isIOSDevice || isIPadOSDesktopUA) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'other';
}

function isStandalone(): boolean {
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
}

const DISMISSED_KEY = 'pwa-install-dismissed';
const INSTALLED_KEY = 'pwa-install-accepted';
const IOS_HELPER_KEY = 'pwa-ios-helper-active';
const DISMISS_COOLDOWN_MS = 48 * 60 * 60 * 1000;
const IOS_SNOOZE_MS = 24 * 60 * 60 * 1000;

type StepCard = {
    title: string;
    detail: string;
    icon: ReactNode;
};

export function PWAInstallPrompt() {
    const [visible, setVisible] = useState(false);
    const [platform, setPlatform] = useState<Platform>('other');
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [isPrompting, setIsPrompting] = useState(false);
    const [iosHelperVisible, setIosHelperVisible] = useState(false);

    useBodyScrollLock(visible);

    const canOneTapInstall = platform === 'android' && !!deferredPrompt;

    useEffect(() => {
        const onBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setDeferredPrompt(event as BeforeInstallPromptEvent);
        };

        const onAppInstalled = () => {
            localStorage.setItem(INSTALLED_KEY, String(Date.now()));
            localStorage.removeItem(IOS_HELPER_KEY);
            setVisible(false);
            setIosHelperVisible(false);
            setDeferredPrompt(null);
        };

        window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener);
        window.addEventListener('appinstalled', onAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener);
            window.removeEventListener('appinstalled', onAppInstalled);
        };
    }, []);

    useEffect(() => {
        if (isStandalone()) return;
        if (window.innerWidth > 768) return;
        if (localStorage.getItem(INSTALLED_KEY)) return;

        const detected = detectPlatform();
        setPlatform(detected);

        if (detected === 'ios' && localStorage.getItem(IOS_HELPER_KEY) === '1') {
            setIosHelperVisible(true);
        }

        const dismissed = localStorage.getItem(DISMISSED_KEY);
        if (dismissed) {
            const dismissedAt = parseInt(dismissed, 10);
            if (Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) return;
        }

        const timer = setTimeout(() => setVisible(true), 2000);
        return () => clearTimeout(timer);
    }, []);

    const dismiss = () => {
        setVisible(false);
        localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    };

    const dismissForOneDay = () => {
        setVisible(false);
        localStorage.setItem(DISMISSED_KEY, String(Date.now() - DISMISS_COOLDOWN_MS + IOS_SNOOZE_MS));
        localStorage.removeItem(IOS_HELPER_KEY);
        setIosHelperVisible(false);
    };

    const handleInstall = async () => {
        if (!deferredPrompt || isPrompting) {
            return;
        }

        setIsPrompting(true);
        try {
            await deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;

            if (choice.outcome === 'accepted') {
                localStorage.setItem(INSTALLED_KEY, String(Date.now()));
                setVisible(false);
            } else {
                localStorage.setItem(DISMISSED_KEY, String(Date.now()));
                setVisible(false);
            }
        } catch (error: unknown) {
            console.error('PWA install prompt failed', error);
        } finally {
            setDeferredPrompt(null);
            setIsPrompting(false);
        }
    };

    const enableIOSHelper = () => {
        setVisible(false);
        setIosHelperVisible(true);
        localStorage.setItem(IOS_HELPER_KEY, '1');
    };

    const sheetTitle = canOneTapInstall ? 'Uygulama gibi kullan' : 'Ana ekrana sabitle';
    const sheetDescription = canOneTapInstall
        ? 'Club Threads daha hizli acilsin, tek dokunusla kur.'
        : platform === 'ios'
          ? 'Iki kisa adimla uygulama gibi acilir.'
          : 'Menu icinden ekleyip tek dokunusla acabilirsin.';

    const steps: StepCard[] = canOneTapInstall
        ? [
              {
                  title: 'Yukle',
                  detail: 'Tarayicinin kurulum penceresi acilacak.',
                  icon: <Download size={16} />,
              },
              {
                  title: 'Hazir',
                  detail: 'Sonraki girislerde direkt uygulama gibi acilir.',
                  icon: <Check size={16} />,
              },
          ]
        : platform === 'ios'
          ? [
                {
                    title: 'Paylas',
                    detail: 'Safari alt bardaki Paylas ikonuna dokun.',
                    icon: <Share size={16} />,
                },
                {
                    title: 'Ana ekrana ekle',
                    detail: '"Ana Ekrana Ekle" secenegini sec.',
                    icon: <Plus size={16} />,
                },
            ]
          : [
                {
                    title: 'Menuyu ac',
                    detail: 'Sag ustteki uc nokta menusune dokun.',
                    icon: <MoreVertical size={16} />,
                },
                {
                    title: 'Uygulamayi yukle',
                    detail: 'Install app veya Ana ekrana ekle sec.',
                    icon: <Download size={16} />,
                },
            ];

    if (!visible && !(iosHelperVisible && platform === 'ios')) return null;

    return (
        <>
            {visible && (
                <div className="fixed inset-0 z-[60] flex items-end justify-center bg-overlay backdrop-blur-sm" onClick={dismiss}>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full animate-slide-up rounded-t-[32px] bg-bg-primary px-5 pb-10 pt-5 shadow-[0_-20px_60px_rgba(0,0,0,0.15)]"
                        style={{ animation: 'slideUp 0.35s ease-out' }}
                    >
                        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/10" />

                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#111827_0%,#2e3b2f_100%)] text-[15px] font-black text-[#d4a853] shadow-[0_10px_25px_rgba(17,24,39,0.22)]">
                                    CT
                                </div>
                                <div>
                                    <div className="text-lg font-black text-text-primary">Club Threads</div>
                                    <div className="text-xs text-text-muted">{sheetTitle}</div>
                                </div>
                            </div>
                            <button onClick={dismiss} className="rounded-full bg-black/5 p-2">
                                <X size={18} className="text-text-secondary" />
                            </button>
                        </div>

                        <div className="rounded-[28px] border border-border-subtle bg-[linear-gradient(180deg,rgba(212,168,83,0.12)_0%,rgba(212,168,83,0.03)_55%,transparent_100%)] p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-text-primary text-inverse-primary">
                                    <Smartphone size={18} />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-base font-black text-text-primary">{sheetTitle}</div>
                                    <p className="mt-1 text-sm leading-6 text-text-secondary">{sheetDescription}</p>
                                </div>
                            </div>
                            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
                                {steps.map((step, index) => (
                                    <div key={step.title} className="contents">
                                        <div className="rounded-2xl border border-border-subtle bg-bg-primary/85 p-3">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-bg-secondary text-text-primary">
                                                {step.icon}
                                            </div>
                                            <div className="mt-3 text-sm font-bold text-text-primary">
                                                {index + 1}. {step.title}
                                            </div>
                                            <div className="mt-1 text-xs leading-5 text-text-secondary">{step.detail}</div>
                                        </div>

                                        {index < steps.length - 1 && (
                                            <div className="flex items-center justify-center text-text-muted">
                                                <ArrowRight size={15} />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {canOneTapInstall ? (
                                <div className="mt-4 space-y-2">
                                    <button
                                        onClick={handleInstall}
                                        disabled={isPrompting}
                                        className="w-full rounded-2xl bg-text-primary py-3.5 text-sm font-bold text-inverse-primary active:scale-[0.99] disabled:opacity-60"
                                    >
                                        {isPrompting ? 'Hazirlaniyor...' : 'Tek dokunusla yukle'}
                                    </button>
                                    <button
                                        onClick={dismiss}
                                        className="w-full rounded-2xl bg-bg-tertiary py-3 text-sm font-semibold text-text-primary"
                                    >
                                        Simdilik kapat
                                    </button>
                                </div>
                            ) : platform === 'ios' ? (
                                <div className="mt-4 grid grid-cols-2 gap-2">
                                    <button
                                        onClick={enableIOSHelper}
                                        className="rounded-2xl bg-text-primary py-3 text-sm font-semibold text-inverse-primary"
                                    >
                                        Simdi deniyorum
                                    </button>
                                    <button
                                        onClick={dismissForOneDay}
                                        className="rounded-2xl bg-bg-tertiary py-3 text-sm font-semibold text-text-primary"
                                    >
                                        1 gun sonra
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={dismiss}
                                    className="mt-4 w-full rounded-2xl bg-text-primary py-3.5 text-sm font-semibold text-inverse-primary"
                                >
                                    Tamam, anladim
                                </button>
                            )}
                        </div>
                    </div>

                    <style>{`
                        @keyframes slideUp {
                            from { transform: translateY(100%); }
                            to { transform: translateY(0); }
                        }
                    `}</style>
                </div>
            )}

            {iosHelperVisible && platform === 'ios' && !isStandalone() && (
                <div className="fixed bottom-[calc(var(--mobile-tabbar-offset)+env(safe-area-inset-bottom)+1rem)] left-1/2 z-[62] w-[min(92vw,420px)] -translate-x-1/2 rounded-3xl border border-border-subtle bg-bg-primary/95 px-4 py-4 shadow-[0_12px_40px_rgba(17,17,17,0.2)] backdrop-blur md:hidden">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">iOS kurulum yardimi</div>
                            <p className="mt-1 text-sm font-semibold text-text-primary">Paylas <span className="inline-flex align-middle"><Share size={13} /></span> sonra Ana Ekrana Ekle <span className="inline-flex align-middle"><Plus size={13} /></span></p>
                            <div className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-bg-secondary text-text-primary">1</span>
                                <span>Alt bardaki Paylas tusu</span>
                                <ArrowRight size={12} className="shrink-0" />
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-bg-secondary text-text-primary">2</span>
                                <span>Listeden ekle</span>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                setIosHelperVisible(false);
                                localStorage.removeItem(IOS_HELPER_KEY);
                            }}
                            className="rounded-full bg-black/5 p-1.5"
                        >
                            <X size={14} className="text-text-secondary" />
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
