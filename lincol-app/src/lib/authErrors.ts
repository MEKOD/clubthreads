import axios from 'axios';

type ValidationFieldErrors = Record<string, string[] | undefined>;

export interface AuthFieldErrors {
    username?: string;
    password?: string;
    general?: string;
}

function firstFieldError(fieldErrors: ValidationFieldErrors | undefined, field: string) {
    return fieldErrors?.[field]?.[0];
}

export function getAuthFieldErrors(error: unknown): AuthFieldErrors {
    if (!axios.isAxiosError(error)) {
        return { general: 'Bir sorun oluştu. Tekrar dene.' };
    }

    const responseData = error.response?.data as
        | { error?: string; details?: { fieldErrors?: ValidationFieldErrors } }
        | undefined;

    const fieldErrors = responseData?.details?.fieldErrors;
    const usernameError = firstFieldError(fieldErrors, 'username');
    const passwordError = firstFieldError(fieldErrors, 'password');
    const message = responseData?.error;

    if (message === 'Validation failed') {
        return {
            username: usernameError,
            password: passwordError,
            general: usernameError || passwordError ? undefined : 'Girilen bilgiler geçersiz.',
        };
    }

    if (message) {
        return { general: message };
    }

    if (error.response) {
        return { general: 'İşlem tamamlanamadı. Tekrar dene.' };
    }

    return { general: 'Sunucuya bağlanılamıyor.' };
}
