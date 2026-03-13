interface VerifiedBadgeProps {
    role?: 'admin' | 'elite' | 'pink' | 'user' | null;
    size?: number;
}

export function VerifiedBadge({ role, size = 16 }: VerifiedBadgeProps) {
    if (!role || role === 'user') return null;

    const fill = role === 'admin' ? '#8b2020' : role === 'pink' ? '#ff4fa3' : '#111111';

    return (
        <svg
            viewBox="0 0 22 22"
            fill="none"
            style={{ width: size, height: size }}
            className="inline-block shrink-0"
            aria-label="Onaylı hesap"
        >
            <circle cx="11" cy="11" r="11" fill={fill} />
            <path
                d="M6.5 11.5L9.5 14.5L15.5 8"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
