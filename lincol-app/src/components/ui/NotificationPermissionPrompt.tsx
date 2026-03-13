import { useEffect, useMemo, useState } from "react";
import { Bell, BellRing, X } from "lucide-react";
import { ensurePushSubscription, requestNotificationPermissionWithHint } from "../../lib/push";

const DISMISS_KEY = "notif-permission-dismissed-at";
const DISMISS_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function detectPlatform(): "ios" | "android" | "other" {
    const ua = navigator.userAgent || "";
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
    const isIPadOSDesktopUA = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    if (isIOSDevice || isIPadOSDesktopUA) return "ios";
    if (/Android/i.test(ua)) return "android";
    return "other";
}

function isStandalone(): boolean {
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
}

export function NotificationPermissionPrompt() {
    const [visible, setVisible] = useState(false);
    const [hint, setHint] = useState<string | null>(null);
    const permission = useMemo(
        () => ("Notification" in window ? Notification.permission : "denied"),
        []
    );

    useEffect(() => {
        if (!("Notification" in window)) return;
        if (permission !== "default") return;
        if (window.innerWidth > 768) return;

        const platform = detectPlatform();
        if (platform === "ios" && !isStandalone()) return;

        const dismissed = localStorage.getItem(DISMISS_KEY);
        if (dismissed) {
            const at = parseInt(dismissed, 10);
            if (!Number.isNaN(at) && Date.now() - at < DISMISS_COOLDOWN_MS) return;
        }

        const timer = setTimeout(() => setVisible(true), 1500);
        return () => clearTimeout(timer);
    }, [permission]);

    if (!visible) return null;

    return (
        <div className="fixed bottom-[calc(var(--mobile-tabbar-offset)+env(safe-area-inset-bottom)+0.75rem)] left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border border-border-subtle bg-bg-primary/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.18)] backdrop-blur md:bottom-6">
            <button
                type="button"
                className="absolute right-2 top-2 rounded-full p-1.5 text-text-muted hover:bg-black/5"
                onClick={() => {
                    setVisible(false);
                    localStorage.setItem(DISMISS_KEY, String(Date.now()));
                }}
                aria-label="Kapat"
            >
                <X size={16} />
            </button>

            <div className="flex items-start gap-3 pr-6">
                <div className="mt-0.5 rounded-xl bg-text-primary p-2.5 text-inverse-primary">
                    <BellRing size={16} />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">Anlik bildirimleri ac</p>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">
                        Mention, reply, fav ve takip bildirimlerini uygulama kapaliyken de al.
                    </p>
                    <button
                        type="button"
                        className="mt-3 inline-flex items-center gap-2 rounded-full bg-text-primary px-3.5 py-2 text-xs font-semibold text-inverse-primary"
                        onClick={async () => {
                            const result = await requestNotificationPermissionWithHint();
                            setHint(result.message ?? null);
                            if (result.permission === "granted") {
                                await ensurePushSubscription();
                                setVisible(false);
                                localStorage.setItem(DISMISS_KEY, String(Date.now()));
                            }
                        }}
                    >
                        <Bell size={14} />
                        Bildirimleri Ac
                    </button>
                    {hint && (
                        <p className="mt-2 text-[11px] leading-5 text-text-muted">{hint}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
