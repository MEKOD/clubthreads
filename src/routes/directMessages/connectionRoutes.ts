import { FastifyInstance } from "fastify";
import type { AuthRequest } from "../../plugins/auth";
import { subscribeToDirectMessages } from "../../services/directMessageHub";
import { getUnreadCount } from "./queries";

export function registerDirectMessageConnectionRoutes(app: FastifyInstance) {
    app.get(
        "/dm/stream",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;

            reply.raw.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            });

            const send = (event: string, data: unknown) => {
                reply.raw.write(`event: ${event}\n`);
                reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
            };

            send("connected", { ok: true, at: new Date().toISOString() });

            const unsubscribe = subscribeToDirectMessages(userId, (payload) => {
                send(payload.event, payload);
            });

            const heartbeat = setInterval(() => {
                send("heartbeat", { at: new Date().toISOString() });
            }, 25_000);

            request.raw.on("close", () => {
                clearInterval(heartbeat);
                unsubscribe();
            });

            return reply.hijack();
        }
    );

    app.get(
        "/dm/unread-count",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const { userId } = request as AuthRequest;
            return reply.send({ unreadCount: await getUnreadCount(userId) });
        }
    );
}
