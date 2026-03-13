import path from "path";
import { z } from "zod";

export const ConversationListQuerySchema = z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
});

export const FriendsQuerySchema = z.object({
    limit: z.string().optional(),
});

export const MediaReferenceSchema = z
    .string()
    .trim()
    .refine((value) => /^https?:\/\//i.test(value) || value.startsWith("/"), {
        message: "Media reference must be an absolute URL or uploaded media path",
    });

const Base64Schema = z.string().trim().regex(/^[A-Za-z0-9+/=]+$/, {
    message: "Expected base64-encoded content",
});

export const DirectMessageEncryptedPayloadSchema = z.object({
    version: z.literal(1),
    algorithm: z.literal("rsa-oaep-256/aes-gcm-256"),
    iv: Base64Schema.min(12).max(512),
    ciphertext: Base64Schema.min(16).max(24000),
    senderWrappedKey: Base64Schema.min(16).max(4096),
    recipientWrappedKey: Base64Schema.min(16).max(4096),
});

export const StartConversationSchema = z.object({
    username: z.string().trim().min(1).max(32),
    includeMessages: z.boolean().optional(),
    messageLimit: z.number().int().positive().max(100).optional(),
});

export const ConversationMessagesQuerySchema = z.object({
    before: z.string().datetime().optional(),
    after: z.string().datetime().optional(),
    beforeSequence: z.string().regex(/^\d+$/).optional(),
    afterSequence: z.string().regex(/^\d+$/).optional(),
    limit: z.string().optional(),
}).refine((value) => {
    const cursorCount = [value.before, value.after, value.beforeSequence, value.afterSequence].filter(Boolean).length;
    return cursorCount <= 1;
}, {
    message: "Use only one cursor at a time",
    path: ["before"],
});

export const SendMessageSchema = z.object({
    content: z.string().trim().min(1).max(2000).optional(),
    encryptedPayload: DirectMessageEncryptedPayloadSchema.optional(),
    mediaUrl: MediaReferenceSchema.optional(),
    mediaMimeType: z.enum(["image/webp", "image/gif", "video/mp4"]).optional(),
    clientMessageId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
    originSessionId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).superRefine((value, ctx) => {
    if (!value.content && !value.mediaUrl && !value.encryptedPayload) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Message must contain text, encrypted payload or media",
            path: ["content"],
        });
    }

    if (value.mediaUrl && !value.mediaMimeType) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "mediaMimeType is required when mediaUrl is provided",
            path: ["mediaMimeType"],
        });
    }

    if (value.mediaMimeType && !value.mediaUrl) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "mediaUrl is required when mediaMimeType is provided",
            path: ["mediaUrl"],
        });
    }

    if (value.mediaMimeType === "video/mp4" && value.mediaUrl && !value.mediaUrl.startsWith("/media/")) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Video messages must use uploaded media",
            path: ["mediaUrl"],
        });
    }

    if (value.mediaMimeType === "image/webp" && value.mediaUrl && !value.mediaUrl.startsWith("/media/")) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Photo messages must use uploaded media",
            path: ["mediaUrl"],
        });
    }
});

export const MarkConversationReadSchema = z.object({
    readThroughMessageId: z.string().uuid().optional(),
    readThroughSequence: z.number().int().positive().optional(),
}).refine((value) => !(value.readThroughMessageId && value.readThroughSequence), {
    message: "Use either readThroughMessageId or readThroughSequence",
    path: ["readThroughMessageId"],
});

export const MarkConversationDeliveredSchema = z.object({
    deliveredThroughMessageId: z.string().uuid().optional(),
    deliveredThroughSequence: z.number().int().positive().optional(),
}).refine((value) => !(value.deliveredThroughMessageId && value.deliveredThroughSequence), {
    message: "Use either deliveredThroughMessageId or deliveredThroughSequence",
    path: ["deliveredThroughMessageId"],
});

export const TypingStateSchema = z.object({
    isTyping: z.boolean(),
});

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
export const MAX_DM_VIDEO_SIZE_BYTES = 8 * 1024 * 1024;
