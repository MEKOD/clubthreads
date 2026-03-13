import bcrypt from "bcrypt";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { communities, notifications, posts, postCommunities, users } from "../db/schema";
import { publishNotificationEvent } from "./notificationHub";
import { hydratePostLinkPreview } from "./linkPreview";

export interface AiBotRedisLike {
    get: (key: string) => Promise<string | null>;
    incr: (key: string) => Promise<number>;
    decr: (key: string) => Promise<number>;
    del: (...keys: string[]) => Promise<number>;
    expire: (key: string, seconds: number) => Promise<number | string>;
    set: (...args: any[]) => Promise<unknown>;
}

const AI_BOT_ENABLED = process.env.AI_BOT_ENABLED === "true";
const AI_BOT_USERNAME = (process.env.AI_BOT_USERNAME ?? "gregor").trim().toLowerCase();
const AI_BOT_MODEL = process.env.AI_BOT_MODEL ?? "gemini-2.5-flash-lite";
const AI_BOT_TIMEOUT_MS = parseInt(process.env.AI_BOT_TIMEOUT_MS ?? "10000", 10);
const AI_BOT_USER_DAILY_LIMIT = parseInt(process.env.AI_BOT_USER_DAILY_LIMIT ?? "3", 10);
const AI_BOT_GLOBAL_DAILY_LIMIT = parseInt(process.env.AI_BOT_GLOBAL_DAILY_LIMIT ?? "300", 10);
const AI_BOT_GLOBAL_MINUTE_LIMIT = parseInt(process.env.AI_BOT_GLOBAL_MINUTE_LIMIT ?? "10", 10);
const AI_BOT_ROOT_POSTS_ONLY = process.env.AI_BOT_ROOT_POSTS_ONLY !== "false";
const AI_BOT_QUOTA_TIMEZONE = process.env.AI_BOT_QUOTA_TIMEZONE ?? "Europe/Istanbul";
const AI_BOT_CONTEXT_LIMIT = parseInt(process.env.AI_BOT_CONTEXT_LIMIT ?? "4", 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_API_URL = process.env.GEMINI_API_URL ?? "https://generativelanguage.googleapis.com/v1beta";
const BOT_BIO = process.env.AI_BOT_BIO ?? "Etiketlersen gelir. Kisa, komik, shitpostcu ve gerektiginde ayarsiz.";

let botUserIdPromise: Promise<string | null> | null = null;

interface AiBotThreadPost {
    id: string;
    content: string | null;
    type: "post" | "rt" | "quote";
    parentId: string | null;
    authorUsername: string;
    authorId: string;
    communitySlug: string | null;
}

function formatQuotaParts(date = new Date(), timeZone = AI_BOT_QUOTA_TIMEZONE) {
    try {
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
        const parts = formatter.formatToParts(date);
        const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
        return {
            year: get("year"),
            month: get("month"),
            day: get("day"),
            hour: get("hour"),
            minute: get("minute"),
        };
    } catch {
        const iso = date.toISOString();
        return {
            year: iso.slice(0, 4),
            month: iso.slice(5, 7),
            day: iso.slice(8, 10),
            hour: iso.slice(11, 13),
            minute: iso.slice(14, 16),
        };
    }
}

function dayKey(date = new Date(), timeZone = AI_BOT_QUOTA_TIMEZONE) {
    const parts = formatQuotaParts(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function minuteKey(date = new Date(), timeZone = AI_BOT_QUOTA_TIMEZONE) {
    const parts = formatQuotaParts(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function extractMentions(content: string) {
    return [...content.matchAll(/@([a-zA-Z0-9._-]+)/g)].map((match) => match[1].toLowerCase());
}

function trimForPrompt(content: string | null | undefined, maxLength = 1200) {
    if (!content) return "";
    return content.trim().slice(0, maxLength);
}

function normalizeGeneratedReply(content: string) {
    return content
        .replace(/^(?:\s*@[\w.-]+\s*)+/i, "")
        .replace(new RegExp(`^@${AI_BOT_USERNAME}\\b[:,\\-\\s]*`, "i"), "")
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280);
}

function canonicalizeForComparison(content: string | null | undefined) {
    return (content ?? "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function containsHardHarassment(content: string) {
    return /\b(amk|aq|oç|oc\b|orospu|piç|pic\b|yarrak|anan[ıi]|siktir|geber|öl(?:\s|$)|mal\b|gerizekal[ıi]|salak\b|aptal\b)\b/i.test(content);
}

function isSensitiveTopic(content: string) {
    return /\b(öcalan|ocalan|erdogan|kılıçdaroğlu|kilicdaroglu|bahçeli|bahceli|imamoglu|yavas|secim|siyaset|politik|teror|örgüt|orgut)\b/i.test(content);
}

function asksForRespect(content: string) {
    return /\b(sayg[ıi](l[ıi])?|saygili|saygılı|uslubunu|üslubunu|terbiyeli|daha duzgun|daha düzgün|daha sakin|sakin ol|kasma|gerilme|gerginlik)\b/i.test(content);
}

function containsBotSelfReference(content: string) {
    return new RegExp(`@${AI_BOT_USERNAME}\\b`, "i").test(content);
}

function buildFallbackReply(input: {
    sourceContent: string;
}) {
    if (asksForRespect(input.sourceContent)) {
        return "Tamam, vitesi dusuruyorum. Bundan sonra daha duz gidelim.";
    }

    if (isSensitiveTopic(input.sourceContent)) {
        return "Bu baslik mayinli tarla. Slogana degil net soruya cevap veririm; biraz daha daralt.";
    }

    if (containsHardHarassment(input.sourceContent)) {
        return "Mention attin diye mahalle kavgasina girmem. Soruyu duzgun kur, ben de tekte oturtayim.";
    }

    return "Baglami gordum ama soru yamuk. Bir tik net yaz, ben de tek cumlede cakayim.";
}

function maybeBuildRuleBasedReply(sourceContent: string) {
    if (asksForRespect(sourceContent)) {
        return "Tamam, vitesi dusuruyorum. Bundan sonra daha duz gidelim.";
    }

    return null;
}

function isNearDuplicateReply(reply: string, thread: AiBotThreadPost[]) {
    const canonicalReply = canonicalizeForComparison(reply);
    if (canonicalReply.length < 16) {
        return false;
    }

    return thread.some((post) => {
        const canonicalPost = canonicalizeForComparison(post.content);
        if (!canonicalPost) {
            return false;
        }

        return canonicalPost === canonicalReply
            || canonicalPost.includes(canonicalReply)
            || canonicalReply.includes(canonicalPost);
    });
}

async function fetchThreadContext(sourcePostId: string) {
    const thread: AiBotThreadPost[] = [];
    const visited = new Set<string>();
    let nextPostId: string | null = sourcePostId;

    while (nextPostId && thread.length < AI_BOT_CONTEXT_LIMIT && !visited.has(nextPostId)) {
        visited.add(nextPostId);

        const [post] = await db
            .select({
                id: posts.id,
                content: posts.content,
                type: posts.type,
                parentId: posts.parentId,
                authorUsername: users.username,
                authorId: users.id,
                communitySlug: communities.slug,
            })
            .from(posts)
            .innerJoin(users, eq(posts.userId, users.id))
            .leftJoin(postCommunities, eq(postCommunities.postId, posts.id))
            .leftJoin(communities, eq(postCommunities.communityId, communities.id))
            .where(eq(posts.id, nextPostId))
            .limit(1);

        if (!post) {
            break;
        }

        thread.push(post);
        nextPostId = post.parentId;
    }

    return thread.reverse();
}

async function consumeLimit(redis: AiBotRedisLike, key: string, limit: number, ttlSeconds: number) {
    const nextValue = await redis.incr(key);
    if (nextValue === 1) {
        await redis.expire(key, ttlSeconds);
    }

    let released = false;
    return {
        allowed: nextValue <= limit,
        current: nextValue,
        release: async () => {
            if (released || nextValue <= 0) {
                return;
            }
            released = true;

            try {
                const currentValue = await redis.decr(key);
                if (currentValue <= 0) {
                    await redis.del(key);
                }
            } catch (error) {
                console.warn(`[aiBot] failed to rollback quota for ${key}: ${(error as Error).message}`);
            }
        },
    };
}

async function fetchGeminiReply(input: {
    sourceContent: string;
    sourceType: "post" | "rt" | "quote";
    thread: AiBotThreadPost[];
    botUserId: string;
    communitySlug?: string | null;
}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_BOT_TIMEOUT_MS);
    const ruleBasedReply = maybeBuildRuleBasedReply(input.sourceContent);

    if (ruleBasedReply) {
        clearTimeout(timeout);
        return ruleBasedReply;
    }

    const parentPost = input.thread.length > 1 ? input.thread[input.thread.length - 2] : null;
    const threadLines = input.thread.map((post, index) => {
        const relation = index === input.thread.length - 1
            ? "CURRENT_POST"
            : index === input.thread.length - 2
                ? input.sourceType === "quote"
                    ? "QUOTED_POST"
                    : "PARENT_POST"
                : "EARLIER_CONTEXT";

        return [
            `${relation} | author=@${post.authorUsername} | author_is_bot=${post.authorId === input.botUserId ? "yes" : "no"} | type=${post.type}`,
            trimForPrompt(post.content, relation === "CURRENT_POST" ? 1000 : 500) || "(icerik yok / medya agirlikli)",
        ].join("\n");
    });

    const systemPrompt = [
        `Sen Club Threads icindeki @${AI_BOT_USERNAME} hesabinin kendisisin.`,
        "Gorevin sadece CURRENT_POST'a cevap vermek.",
        "Asla yazar rolleri karistirma.",
        `author_is_bot=yes olan mesajlar senin onceki mesajlarindir; bunlari baska bir kullanicinin mesaji gibi yorumlama.`,
        "CURRENT_POST her zaman kullanicinin su an yazdigi son mesaji temsil eder.",
        "Eger CURRENT_POST type=quote ise QUOTED_POST sadece referanstir; asil cevabi CURRENT_POST metnine ver.",
        "Eger CURRENT_POST bir reply ise PARENT_POST konusmanin bir onceki mesajidir.",
        "Once soruyu ve kime ne dendigini dogru anla, sonra cevap ver.",
        "Turkce yaz. 1-2 kisa cumle yeterli. Kisa, zeki, hafif alayci ve internet dili bilen olabilirsin.",
        "Ama dogrudan hakaret etme, kufur kusma, kullaniciya ol/geber vb. seyler soyleme, tehdit etme, asagilayici slur kullanma.",
        "Kullanici sertse bile mizahla yumusat veya sinir ciz; ayni tonda toksiklesme.",
        "Politik, siddet, etnik veya benzeri mayinli konularda slogan atma; bilmiyorsan ya da konu riskliyse kisa ve kontrollu sekilde gec.",
        "Bilmedigin seyi uydurma. Soruyu anlamadiysan bunu kisa ve net soyle.",
        "Sadece nihai cevabi yaz; aciklama, analiz veya rol etiketi yazma.",
    ].join(" ");

    const userPrompt = [
        `BOT_HANDLE: @${AI_BOT_USERNAME}`,
        input.communitySlug ? `COMMUNITY: /${input.communitySlug}` : null,
        `CURRENT_POST_TYPE: ${input.sourceType}`,
        parentPost ? `PARENT_AUTHOR: @${parentPost.authorUsername}` : null,
        "THREAD_CONTEXT:",
        ...threadLines,
        "TASK: CURRENT_POST'a dogrudan cevap ver.",
    ].filter(Boolean).join("\n\n");

    try {
        const response = await fetch(
            `${GEMINI_API_URL}/models/${encodeURIComponent(AI_BOT_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: systemPrompt }],
                    },
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: userPrompt }],
                        },
                    ],
                    generationConfig: {
                        temperature: 0.45,
                        topP: 0.8,
                        maxOutputTokens: 120,
                    },
                }),
                signal: controller.signal,
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini HTTP ${response.status}`);
        }

        const data = (await response.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
        const normalized = normalizeGeneratedReply(text);
        if (!normalized) {
            return "";
        }

        if (containsBotSelfReference(normalized)) {
            return buildFallbackReply({ sourceContent: input.sourceContent });
        }

        if (containsHardHarassment(normalized)) {
            return buildFallbackReply({ sourceContent: input.sourceContent });
        }

        if (isNearDuplicateReply(normalized, input.thread)) {
            return buildFallbackReply({ sourceContent: input.sourceContent });
        }

        return normalized;
    } finally {
        clearTimeout(timeout);
    }
}

async function createBotReply(input: {
    botUserId: string;
    sourcePostId: string;
    sourceUserId: string;
    communityId?: string;
    content: string;
}) {
    const result = await db.transaction(async (tx) => {
        const [createdPost] = await tx
            .insert(posts)
            .values({
                userId: input.botUserId,
                content: input.content,
                parentId: input.sourcePostId,
                type: "post",
            })
            .returning();

        if (input.communityId) {
            await tx.insert(postCommunities).values({
                postId: createdPost.id,
                communityId: input.communityId,
            });
        }

        await tx
            .update(posts)
            .set({ replyCount: sql`${posts.replyCount} + 1` })
            .where(eq(posts.id, input.sourcePostId));

        if (input.sourceUserId !== input.botUserId) {
            await tx.insert(notifications).values({
                userId: input.sourceUserId,
                actorId: input.botUserId,
                type: "reply",
                postId: createdPost.id,
            });
        }

        return createdPost;
    });

    if (input.sourceUserId !== input.botUserId) {
        publishNotificationEvent({
            event: "notification:new",
            userId: input.sourceUserId,
            actorId: input.botUserId,
            postId: result.id,
            notificationType: "reply",
            at: new Date().toISOString(),
        });
    }

    void hydratePostLinkPreview(result.id, input.content).catch(() => { });
}

export async function ensureAiBotUser() {
    if (!AI_BOT_ENABLED || !AI_BOT_USERNAME) {
        return null;
    }

    if (!botUserIdPromise) {
        botUserIdPromise = (async () => {
            const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, AI_BOT_USERNAME)).limit(1);
            if (existing) {
                await db
                    .update(users)
                    .set({ bio: BOT_BIO, isActive: true, updatedAt: new Date() })
                    .where(eq(users.id, existing.id));
                return existing.id;
            }

            const passwordHash = await bcrypt.hash(`bot_${Date.now()}_${Math.random().toString(36).slice(2)}`, 12);
            const [created] = await db
                .insert(users)
                .values({
                    username: AI_BOT_USERNAME,
                    passwordHash,
                    bio: BOT_BIO,
                    role: "user",
                    isActive: true,
                })
                .returning({ id: users.id });

            return created.id;
        })();
    }

    return botUserIdPromise;
}

export async function maybeQueueAiBotReply(input: {
    redis?: AiBotRedisLike;
    sourcePostId: string;
    sourceUserId: string;
    content: string | null | undefined;
    parentId?: string | null;
    communityId?: string;
}) {
    if (!AI_BOT_ENABLED || !GEMINI_API_KEY || !input.redis) {
        return;
    }

    const content = (input.content ?? "").trim();
    if (!content) {
        return;
    }

    if (AI_BOT_ROOT_POSTS_ONLY && input.parentId) {
        return;
    }

    const mentions = extractMentions(content);
    if (!mentions.includes(AI_BOT_USERNAME)) {
        return;
    }

    const botUserId = await ensureAiBotUser();
    if (!botUserId || botUserId === input.sourceUserId) {
        return;
    }

    const dedupeKey = `ai:bot:post:${input.sourcePostId}`;
    const dedupeResult = await input.redis.set(dedupeKey, "1", "EX", 60 * 60 * 24 * 2, "NX");
    if (dedupeResult !== "OK") {
        return;
    }

    const now = new Date();
    const day = dayKey(now);
    const minute = minuteKey(now);
    const userLimitResult = await consumeLimit(input.redis, `ai:bot:user:${input.sourceUserId}:${day}`, AI_BOT_USER_DAILY_LIMIT, 60 * 60 * 24 * 2);

    if (!userLimitResult.allowed) {
        // Limit dolunca bir kez (tam limitin bir üstünde) fırça atsın
        if (userLimitResult.current === AI_BOT_USER_DAILY_LIMIT + 1) {
            await createBotReply({
                botUserId,
                sourcePostId: input.sourcePostId,
                sourceUserId: input.sourceUserId,
                communityId: input.communityId,
                content: "Günlük 3 hakkın doldu kanka. Beni darlayıp durma, yarın gel.",
            });
        }
        return;
    }

    const globalDailyResult = await consumeLimit(input.redis, `ai:bot:global:day:${day}`, AI_BOT_GLOBAL_DAILY_LIMIT, 60 * 60 * 24 * 2);
    const globalMinuteResult = await consumeLimit(input.redis, `ai:bot:global:minute:${minute}`, AI_BOT_GLOBAL_MINUTE_LIMIT, 60 * 5);

    if (!globalDailyResult.allowed || !globalMinuteResult.allowed) {
        await Promise.all([
            userLimitResult.release(),
            globalDailyResult.release(),
            globalMinuteResult.release(),
        ]);
        await input.redis.del(dedupeKey).catch(() => 0);
        return;
    }

    const rollbackQuota = async () => {
        await Promise.all([
            userLimitResult.release(),
            globalDailyResult.release(),
            globalMinuteResult.release(),
        ]);
    };

    const thread = await fetchThreadContext(input.sourcePostId);
    const sourcePost = thread[thread.length - 1];

    if (!sourcePost?.content) {
        await rollbackQuota();
        await input.redis.del(dedupeKey).catch(() => 0);
        return;
    }

    try {
        const reply = await fetchGeminiReply({
            sourceContent: sourcePost.content,
            sourceType: sourcePost.type,
            thread,
            botUserId,
            communitySlug: sourcePost.communitySlug ?? null,
        });

        if (!reply) {
            await rollbackQuota();
            await input.redis.del(dedupeKey).catch(() => 0);
            return;
        }

        await createBotReply({
            botUserId,
            sourcePostId: input.sourcePostId,
            sourceUserId: input.sourceUserId,
            communityId: input.communityId,
            content: reply,
        });
    } catch (error) {
        await rollbackQuota();
        await input.redis.del(dedupeKey).catch(() => 0);
        throw error;
    }
}
