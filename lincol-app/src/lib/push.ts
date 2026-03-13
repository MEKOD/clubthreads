import { api } from "./axios";

function isStandaloneMode(): boolean {
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
}

function isIOS(): boolean {
    const ua = navigator.userAgent || "";
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
    const isIPadOSDesktopUA = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return isIOSDevice || isIPadOSDesktopUA;
}

export type NotificationPermissionResult = {
    permission: NotificationPermission | "unsupported";
    message?: string;
};

export async function requestNotificationPermissionWithHint(): Promise<NotificationPermissionResult> {
    if (!("Notification" in window)) {
        return {
            permission: "unsupported",
            message: "Bu cihaz/tarayici bildirim API'sini desteklemiyor.",
        };
    }

    if (Notification.permission === "denied") {
        return {
            permission: "denied",
            message: "Bildirim izni tarayici ayarlarindan tekrar acilmali.",
        };
    }

    if (isIOS() && !isStandaloneMode()) {
        return {
            permission: Notification.permission,
            message: "iPhone'da bildirim icin uygulamayi ana ekrana ekleyip oradan acmalisin.",
        };
    }

    const permission = await Notification.requestPermission();
    return { permission };
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
    const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
        output[i] = raw.charCodeAt(i);
    }
    return output;
}

async function getVapidPublicKey(): Promise<string | null> {
    try {
        const response = await api.get("/notifications/vapid-public-key");
        return response.data?.publicKey ?? null;
    } catch {
        return null;
    }
}

export async function ensurePushSubscription(): Promise<void> {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;

    const vapidPublicKey = await getVapidPublicKey();
    if (!vapidPublicKey) return;

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToUint8Array(vapidPublicKey) as unknown as BufferSource,
        });
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

    await api.post("/notifications/push-subscriptions", {
        endpoint: json.endpoint,
        keys: {
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
        },
    });
}

export async function clearPushSubscription(token?: string | null): Promise<void> {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    try {
        await api.delete("/notifications/push-subscriptions", {
            data: { endpoint: subscription.endpoint },
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
    } catch {
        // Best effort cleanup on server side.
    }

    await subscription.unsubscribe();
}
