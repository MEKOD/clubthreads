import { FastifyInstance } from "fastify";
import { registerDirectMessageConnectionRoutes } from "./directMessages/connectionRoutes";
import { registerDirectMessageConversationRoutes } from "./directMessages/conversationRoutes";
import { registerDirectMessageMessageRoutes } from "./directMessages/messageRoutes";

export async function directMessageRoutes(app: FastifyInstance) {
    registerDirectMessageConnectionRoutes(app);
    registerDirectMessageConversationRoutes(app);
    registerDirectMessageMessageRoutes(app);
}
