import { api } from '../../lib/axios';
import { useDmCryptoStore } from '../../store/dmCryptoStore';

const DM_CRYPTO_ALGORITHM = 'rsa-oaep-256/aes-gcm-256';
const PRIVATE_KEY_SALT_BYTES = 16;
const PRIVATE_KEY_IV_BYTES = 12;
const MESSAGE_IV_BYTES = 12;
const PBKDF2_ITERATIONS = 250_000;

export interface DmCryptoBundle {
    version: 1;
    algorithm: typeof DM_CRYPTO_ALGORITHM;
    publicKey: JsonWebKey;
    encryptedPrivateKey: string;
    privateKeyIv: string;
    privateKeySalt: string;
}

export interface DirectMessageEncryptedPayload {
    version: 1;
    algorithm: typeof DM_CRYPTO_ALGORITHM;
    iv: string;
    ciphertext: string;
    senderWrappedKey: string;
    recipientWrappedKey: string;
}

function toBase64(input: ArrayBuffer | Uint8Array) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let binary = '';

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return globalThis.btoa(binary);
}

function fromBase64(input: string) {
    const binary = globalThis.atob(input);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function isDmCryptoBundle(value: unknown): value is DmCryptoBundle {
    return isRecord(value)
        && value.version === 1
        && value.algorithm === DM_CRYPTO_ALGORITHM
        && isRecord(value.publicKey)
        && typeof value.encryptedPrivateKey === 'string'
        && typeof value.privateKeyIv === 'string'
        && typeof value.privateKeySalt === 'string';
}

export function isDirectMessageEncryptedPayload(value: unknown): value is DirectMessageEncryptedPayload {
    return isRecord(value)
        && value.version === 1
        && value.algorithm === DM_CRYPTO_ALGORITHM
        && typeof value.iv === 'string'
        && typeof value.ciphertext === 'string'
        && typeof value.senderWrappedKey === 'string'
        && typeof value.recipientWrappedKey === 'string';
}

async function derivePrivateKeyWrapKey(password: string, salt: ArrayBuffer) {
    const passwordBytes = new TextEncoder().encode(password);
    const baseKey = await crypto.subtle.importKey(
        'raw',
        passwordBytes,
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        baseKey,
        {
            name: 'AES-GCM',
            length: 256,
        },
        false,
        ['encrypt', 'decrypt']
    );
}

async function importDmPublicKey(publicKey: JsonWebKey) {
    return crypto.subtle.importKey(
        'jwk',
        publicKey,
        {
            name: 'RSA-OAEP',
            hash: 'SHA-256',
        },
        false,
        ['encrypt']
    );
}

async function importDmPrivateKey(privateKey: JsonWebKey) {
    return crypto.subtle.importKey(
        'jwk',
        privateKey,
        {
            name: 'RSA-OAEP',
            hash: 'SHA-256',
        },
        false,
        ['decrypt']
    );
}

export async function generateDmCryptoBundle(password: string) {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt']
    );

    const [publicKey, privateKey] = await Promise.all([
        crypto.subtle.exportKey('jwk', keyPair.publicKey),
        crypto.subtle.exportKey('jwk', keyPair.privateKey),
    ]);

    const salt = crypto.getRandomValues(new Uint8Array(PRIVATE_KEY_SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(PRIVATE_KEY_IV_BYTES));
    const wrapKey = await derivePrivateKeyWrapKey(password, salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength));
    const encryptedPrivateKey = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv,
        },
        wrapKey,
        new TextEncoder().encode(JSON.stringify(privateKey))
    );

    return {
        publicKey,
        privateKey,
        bundle: {
            version: 1 as const,
            algorithm: DM_CRYPTO_ALGORITHM,
            publicKey,
            encryptedPrivateKey: toBase64(encryptedPrivateKey),
            privateKeyIv: toBase64(iv),
            privateKeySalt: toBase64(salt),
        },
    };
}

export async function decryptDmCryptoBundle(bundle: DmCryptoBundle, password: string) {
    const wrapKey = await derivePrivateKeyWrapKey(password, fromBase64(bundle.privateKeySalt));
    const decryptedPrivateKey = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: fromBase64(bundle.privateKeyIv),
        },
        wrapKey,
        fromBase64(bundle.encryptedPrivateKey)
    );

    return JSON.parse(new TextDecoder().decode(decryptedPrivateKey)) as JsonWebKey;
}

export async function ensureDmCryptoForSession(input: {
    userId: string;
    password: string;
    bundle?: unknown;
}) {
    const current = useDmCryptoStore.getState();
    if (current.ownerUserId === input.userId && current.publicKey && current.privateKey) {
        return {
            publicKey: current.publicKey,
            privateKey: current.privateKey,
        };
    }

    const resolvedBundle = isDmCryptoBundle(input.bundle)
        ? input.bundle
        : (await api.get('/auth/me/dm-crypto')).data.dmCrypto;

    if (isDmCryptoBundle(resolvedBundle)) {
        const privateKey = await decryptDmCryptoBundle(resolvedBundle, input.password);
        useDmCryptoStore.getState().setKeyPair(input.userId, resolvedBundle.publicKey, privateKey);
        return {
            publicKey: resolvedBundle.publicKey,
            privateKey,
        };
    }

    const generated = await generateDmCryptoBundle(input.password);
    await api.post('/auth/me/dm-crypto', { dmCrypto: generated.bundle });
    useDmCryptoStore.getState().setKeyPair(input.userId, generated.publicKey, generated.privateKey);

    return {
        publicKey: generated.publicKey,
        privateKey: generated.privateKey,
    };
}

export async function encryptDirectMessageContent(input: {
    text: string;
    senderPublicKey: JsonWebKey;
    recipientPublicKey: JsonWebKey;
}) {
    const aesKey = await crypto.subtle.generateKey(
        {
            name: 'AES-GCM',
            length: 256,
        },
        true,
        ['encrypt', 'decrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(MESSAGE_IV_BYTES));
    const plaintext = new TextEncoder().encode(input.text);
    const ciphertext = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv,
        },
        aesKey,
        plaintext
    );

    const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);
    const [senderKey, recipientKey] = await Promise.all([
        importDmPublicKey(input.senderPublicKey),
        importDmPublicKey(input.recipientPublicKey),
    ]);

    const [senderWrappedKey, recipientWrappedKey] = await Promise.all([
        crypto.subtle.encrypt({ name: 'RSA-OAEP' }, senderKey, rawAesKey),
        crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientKey, rawAesKey),
    ]);

    return {
        version: 1 as const,
        algorithm: DM_CRYPTO_ALGORITHM,
        iv: toBase64(iv),
        ciphertext: toBase64(ciphertext),
        senderWrappedKey: toBase64(senderWrappedKey),
        recipientWrappedKey: toBase64(recipientWrappedKey),
    };
}

export async function decryptDirectMessageContent(input: {
    encryptedPayload: unknown;
    senderId: string;
    currentUserId?: string;
    privateKey: JsonWebKey | null;
}) {
    if (!isDirectMessageEncryptedPayload(input.encryptedPayload) || !input.privateKey || !input.currentUserId) {
        return null;
    }

    const wrappedKey = input.senderId === input.currentUserId
        ? input.encryptedPayload.senderWrappedKey
        : input.encryptedPayload.recipientWrappedKey;

    const privateKey = await importDmPrivateKey(input.privateKey);
    const rawAesKey = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        fromBase64(wrappedKey)
    );
    const aesKey = await crypto.subtle.importKey(
        'raw',
        rawAesKey,
        {
            name: 'AES-GCM',
        },
        false,
        ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: fromBase64(input.encryptedPayload.iv),
        },
        aesKey,
        fromBase64(input.encryptedPayload.ciphertext)
    );

    return new TextDecoder().decode(decrypted);
}
