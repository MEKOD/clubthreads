import type { DirectMessage } from '../../lib/social';

export interface SearchUser {
    id: string;
    username: string;
    handle: string;
    bio: string | null;
    profilePic: string | null;
    role: 'admin' | 'elite' | 'pink' | 'user';
}

export interface LocalDirectMessage extends DirectMessage {
    localId?: string;
    status?: 'sending' | 'failed';
}

export interface ComposerAttachment {
    kind: 'file' | 'gif';
    previewUrl: string;
    mediaMimeType: string;
    file?: File;
}
