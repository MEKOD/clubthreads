import type { FastifyRequest } from "fastify";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function getClientIp(request: FastifyRequest) {
    return ((request.headers["cf-connecting-ip"] as string | undefined) ?? request.ip ?? "").trim() || undefined;
}

export function isTurnstileEnabled() {
    return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstileToken(request: FastifyRequest, token?: string | null) {
    if (!isTurnstileEnabled()) {
        return { ok: true as const };
    }

    if (!token?.trim()) {
        return {
            ok: false as const,
            status: 400,
            error: "Captcha dogrulamasi gerekli",
        };
    }

    try {
        const formData = new URLSearchParams({
            secret: process.env.TURNSTILE_SECRET_KEY!,
            response: token.trim(),
        });

        const remoteIp = getClientIp(request);
        if (remoteIp) {
            formData.set("remoteip", remoteIp);
        }

        const response = await fetch(TURNSTILE_VERIFY_URL, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
            },
            body: formData.toString(),
        });

        if (!response.ok) {
            return {
                ok: false as const,
                status: 503,
                error: "Captcha servisine ulasilamadi",
            };
        }

        const data = (await response.json()) as { success?: boolean };
        if (!data.success) {
            return {
                ok: false as const,
                status: 403,
                error: "Captcha dogrulamasi basarisiz",
            };
        }

        return { ok: true as const };
    } catch {
        return {
            ok: false as const,
            status: 503,
            error: "Captcha servisine ulasilamadi",
        };
    }
}
