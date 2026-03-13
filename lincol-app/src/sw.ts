/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<unknown>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const IMAGE_RUNTIME_CACHE = "club-threads-images-v1";

function isMessagesPath(pathname: string) {
    return pathname === "/messages" || pathname.startsWith("/messages/");
}

async function shouldSuppressPushNotification(targetUrl?: string) {
    if (!targetUrl) {
        return false;
    }

    const targetPathname = new URL(targetUrl, self.location.origin).pathname;
    if (!isMessagesPath(targetPathname)) {
        return false;
    }

    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

    return clients.some((client) => {
        const pathname = new URL(client.url).pathname;
        return isMessagesPath(pathname) && client.visibilityState === "visible";
    });
}

self.addEventListener("fetch", (event) => {
    const { request } = event;

    if (request.method !== "GET" || request.destination !== "image") {
        return;
    }

    event.respondWith((async () => {
        const cache = await caches.open(IMAGE_RUNTIME_CACHE);
        const cachedResponse = await cache.match(request);
        const networkPromise = fetch(request)
            .then((response) => {
                if (response.ok || response.type === "opaque") {
                    void cache.put(request, response.clone());
                }
                return response;
            })
            .catch((error) => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                throw error;
            });

        if (cachedResponse) {
            void networkPromise;
            return cachedResponse;
        }

        return networkPromise;
    })());
});

self.addEventListener("push", (event) => {
    if (!event.data) return;

    let payload: {
        title?: string;
        body?: string;
        icon?: string;
        badge?: string;
        tag?: string;
        url?: string;
        requireInteraction?: boolean;
        renotify?: boolean;
        vibrate?: number[];
    } = {};

    try {
        payload = event.data.json();
    } catch {
        payload = { title: "Yeni bildirim", body: event.data.text() };
    }

    event.waitUntil((async () => {
        if (await shouldSuppressPushNotification(payload.url)) {
            return;
        }

        const title = payload.title ?? "Yeni bildirim";
        const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
            body: payload.body ?? "Hesabinda yeni bir hareket var.",
            icon: payload.icon ?? "/pwa-192x192.png",
            badge: payload.badge ?? "/pwa-192x192.png",
            tag: payload.tag ?? "club-threads-notification",
            requireInteraction: payload.requireInteraction ?? false,
            renotify: payload.renotify ?? false,
            vibrate: payload.vibrate,
            data: {
                url: payload.url ?? "/notifications",
            },
        };

        await self.registration.showNotification(title, options);
    })());
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const targetPath = (event.notification.data?.url as string | undefined) ?? "/notifications";
    const absoluteTarget = new URL(targetPath, self.location.origin).toString();

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ("focus" in client && client.url === absoluteTarget) {
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(absoluteTarget);
            }
            return undefined;
        })
    );
});
