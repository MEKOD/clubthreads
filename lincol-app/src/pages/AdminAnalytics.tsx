import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/axios';
import { useAuthStore } from '../store/authStore';

interface VisitorAnalyticsBucket {
    label: string;
    count: number;
}

interface VisitorAnalyticsSession {
    userId: string;
    username: string;
    sessionId: string;
    firstSeenAt: string;
    lastSeenAt: string;
    eventCount: number;
    status: 'active' | 'idle' | 'ended';
    country: string | null;
    region: string | null;
    city: string | null;
    district: string | null;
    neighborhood: string | null;
    postalCode: string | null;
    os: string | null;
    osVersion: string | null;
    browser: string | null;
    browserVersion: string | null;
    deviceType: string | null;
    vendor: string | null;
    model: string | null;
    userAgent: string | null;
    referer: string | null;
    host: string | null;
    ipAddress: string | null;
    ipMasked: string | null;
    lastSurface: string | null;
    lastPath: string | null;
    lastEventType: string | null;
}

interface VisitorAnalyticsReport {
    overview: {
        days: number;
        activeWindowMinutes: number;
        visitors: number;
        sessions: number;
        activeNowUsers: number;
        activeNowSessions: number;
        endedSessions: number;
        avgEventsPerSession: number;
        cityResolvedSessions: number;
        districtResolvedSessions: number;
        deviceResolvedSessions: number;
        lastSeenAt: string | null;
    };
    locations: {
        countries: VisitorAnalyticsBucket[];
        regions: VisitorAnalyticsBucket[];
        cities: VisitorAnalyticsBucket[];
        districts: VisitorAnalyticsBucket[];
    };
    devices: {
        deviceTypes: VisitorAnalyticsBucket[];
        operatingSystems: VisitorAnalyticsBucket[];
        browsers: VisitorAnalyticsBucket[];
    };
    activeVisitors: VisitorAnalyticsSession[];
    recentVisitors: VisitorAnalyticsSession[];
}

const RANGE_OPTIONS = [
    { label: '24 saat', days: 1 },
    { label: '7 gun', days: 7 },
    { label: '30 gun', days: 30 },
];

const numberFormatter = new Intl.NumberFormat('tr-TR');

function formatNumber(value: number) {
    return numberFormatter.format(value);
}

function formatDateTime(value: string | null) {
    if (!value) {
        return '-';
    }

    return new Intl.DateTimeFormat('tr-TR', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

function formatRelative(value: string | null) {
    if (!value) {
        return '-';
    }

    const date = new Date(value);
    const diffMs = date.getTime() - Date.now();
    const diffMinutes = Math.round(diffMs / 60_000);
    const formatter = new Intl.RelativeTimeFormat('tr-TR', { numeric: 'auto' });

    if (Math.abs(diffMinutes) < 60) {
        return formatter.format(diffMinutes, 'minute');
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) {
        return formatter.format(diffHours, 'hour');
    }

    return formatter.format(Math.round(diffHours / 24), 'day');
}

function formatStatus(status: VisitorAnalyticsSession['status']) {
    if (status === 'active') return 'aktif';
    if (status === 'ended') return 'kapandi';
    return 'idle';
}

function statusClasses(status: VisitorAnalyticsSession['status']) {
    if (status === 'active') {
        return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300';
    }

    if (status === 'ended') {
        return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300';
    }

    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
}

function formatLocation(session: VisitorAnalyticsSession) {
    const parts = [
        session.neighborhood ?? session.district,
        session.city,
        session.region,
        session.country,
    ].filter(Boolean);

    if (parts.length > 0) {
        return parts.join(' / ');
    }

    return session.postalCode ?? '-';
}

function formatDeviceType(deviceType: string | null) {
    if (deviceType === 'mobile') return 'Mobil';
    if (deviceType === 'tablet') return 'Tablet';
    if (deviceType === 'desktop') return 'Desktop';
    if (deviceType === 'bot') return 'Bot';
    return deviceType;
}

function formatDevice(session: VisitorAnalyticsSession) {
    const parts = [
        formatDeviceType(session.deviceType),
        session.os ? `${session.os}${session.osVersion ? ` ${session.osVersion}` : ''}` : null,
        session.browser ? `${session.browser}${session.browserVersion ? ` ${session.browserVersion}` : ''}` : null,
        session.vendor || session.model ? [session.vendor, session.model].filter(Boolean).join(' ') : null,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(' · ') : '-';
}

function formatIp(session: VisitorAnalyticsSession) {
    return session.ipAddress ?? session.ipMasked ?? '-';
}

function formatPath(session: VisitorAnalyticsSession) {
    return session.lastPath ?? session.lastSurface ?? session.lastEventType ?? '-';
}

function topLocationBuckets(report: VisitorAnalyticsReport) {
    if (report.locations.cities.length > 0) {
        return report.locations.cities;
    }
    if (report.locations.districts.length > 0) {
        return report.locations.districts;
    }
    if (report.locations.countries.length > 0) {
        return report.locations.countries;
    }
    return report.locations.regions;
}

function MetricCell(props: { label: string; value: string; detail?: string }) {
    return (
        <div className="px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{props.label}</div>
            <div className="mt-2 text-[28px] font-black tracking-tight text-text-primary">{props.value}</div>
            {props.detail ? <div className="mt-1 text-sm text-text-secondary">{props.detail}</div> : null}
        </div>
    );
}

function DistributionCard(props: { title: string; buckets: VisitorAnalyticsBucket[] }) {
    const total = props.buckets.reduce((sum, bucket) => sum + bucket.count, 0);

    return (
        <section className="rounded-[26px] border border-border-subtle bg-bg-secondary/80 p-4 shadow-[0_10px_30px_rgba(17,17,17,0.05)]">
            <div className="text-sm font-bold tracking-tight text-text-primary">{props.title}</div>

            {props.buckets.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-border bg-bg-primary px-3 py-4 text-sm text-text-secondary">
                    Veri yok
                </div>
            ) : (
                <div className="mt-4 space-y-3">
                    {props.buckets.slice(0, 8).map((bucket) => (
                        <div key={bucket.label}>
                            <div className="flex items-center justify-between gap-3 text-sm">
                                <div className="truncate font-medium text-text-primary">{bucket.label}</div>
                                <div className="text-text-secondary">
                                    {formatNumber(bucket.count)}
                                    {total > 0 ? ` · %${Math.round((bucket.count / total) * 100)}` : ''}
                                </div>
                            </div>
                            <div className="mt-1.5 h-1.5 rounded-full bg-bg-primary">
                                <div
                                    className="h-full rounded-full bg-[linear-gradient(90deg,#0f1419_0%,#7aa63a_100%)] dark:bg-[linear-gradient(90deg,#f3f4f6_0%,#98c14d_100%)]"
                                    style={{ width: `${Math.max(10, Math.round((bucket.count / Math.max(props.buckets[0]?.count ?? 1, 1)) * 100))}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

export function AdminAnalytics() {
    const user = useAuthStore((state) => state.user);
    const [days, setDays] = useState(7);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [report, setReport] = useState<VisitorAnalyticsReport | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

    useEffect(() => {
        if (user?.role !== 'admin') {
            return;
        }

        let cancelled = false;

        const loadReport = async (background = false) => {
            if (background) {
                setIsRefreshing(true);
            } else {
                setIsLoading(true);
            }

            try {
                const response = await api.get<VisitorAnalyticsReport>('/admin/analytics/visitors', {
                    params: { days, limit: 60 },
                });

                if (cancelled) {
                    return;
                }

                setReport(response.data);
                setError(null);
                setLastUpdatedAt(new Date().toISOString());
            } catch (loadError) {
                if (cancelled) {
                    return;
                }

                console.error('Admin analytics alinamadi', loadError);
                setError('Rapor yuklenemedi');
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                    setIsRefreshing(false);
                }
            }
        };

        void loadReport();
        const intervalId = window.setInterval(() => {
            void loadReport(true);
        }, 30_000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [days, refreshNonce, user?.role]);

    if (user?.role !== 'admin') {
        return (
            <div className="min-h-screen bg-bg-primary text-text-primary">
                <header className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))] z-30 flex items-center gap-4 border-b border-border-subtle bg-bg-primary/90 px-4 py-4 backdrop-blur-md md:top-0">
                    <Link to="/" className="rounded-full p-2 transition-colors hover:bg-bg-secondary">
                        <ArrowLeft size={22} />
                    </Link>
                    <h1 className="text-xl font-bold tracking-tight">Ziyaretci Analitigi</h1>
                </header>

                <div className="mx-auto max-w-2xl px-4 py-8">
                    <div className="rounded-[28px] border border-border-subtle bg-bg-secondary p-6 text-center shadow-[0_18px_50px_rgba(17,17,17,0.08)]">
                        <ShieldAlert className="mx-auto h-10 w-10 text-text-secondary" />
                        <div className="mt-4 text-xl font-bold">Bu ekran sadece admin icin acik.</div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-bg-primary text-text-primary">
            <header className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))] z-30 border-b border-border-subtle bg-bg-primary/92 backdrop-blur-md md:top-0">
                <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-3">
                        <Link to="/settings" className="rounded-full p-2 transition-colors hover:bg-bg-secondary">
                            <ArrowLeft size={22} />
                        </Link>
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">Admin</div>
                            <h1 className="text-[32px] font-black tracking-tight">Ziyaretci Analitigi</h1>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {RANGE_OPTIONS.map((option) => (
                            <button
                                key={option.days}
                                type="button"
                                onClick={() => setDays(option.days)}
                                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                                    days === option.days
                                        ? 'bg-text-primary text-inverse-primary'
                                        : 'border border-border-subtle bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}

                        <button
                            type="button"
                            onClick={() => setRefreshNonce((current) => current + 1)}
                            className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-bg-secondary px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-tertiary"
                        >
                            {isRefreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                            Yenile
                        </button>
                    </div>
                </div>
            </header>

            <div className="mx-auto w-full max-w-[1480px] px-4 py-5">
                {isLoading && !report ? (
                    <div className="flex min-h-[40vh] items-center justify-center">
                        <div className="inline-flex items-center gap-3 rounded-full border border-border-subtle bg-bg-secondary px-5 py-3 text-sm text-text-secondary">
                            <Loader2 size={18} className="animate-spin" />
                            Yukleniyor
                        </div>
                    </div>
                ) : report ? (
                    <>
                        <section className="overflow-hidden rounded-[28px] border border-border-subtle bg-bg-secondary/80 shadow-[0_16px_40px_rgba(17,17,17,0.05)]">
                            <div className="grid divide-y divide-border-subtle md:grid-cols-3 md:divide-x md:divide-y-0 xl:grid-cols-6">
                                <MetricCell label="Aktif User" value={formatNumber(report.overview.activeNowUsers)} detail={`${formatNumber(report.overview.activeNowSessions)} acik oturum`} />
                                <MetricCell label="Ziyaretci" value={formatNumber(report.overview.visitors)} detail={`${report.overview.days} gun`} />
                                <MetricCell label="Toplam Oturum" value={formatNumber(report.overview.sessions)} detail={`${formatNumber(report.overview.endedSessions)} kapandi`} />
                                <MetricCell label="Event / Oturum" value={report.overview.avgEventsPerSession.toFixed(1)} detail={`${formatNumber(report.overview.deviceResolvedSessions)} cihaz cozuldu`} />
                                <MetricCell label="Sehir" value={formatNumber(report.overview.cityResolvedSessions)} detail={`${formatNumber(report.overview.districtResolvedSessions)} ilce / mahalle`} />
                                <MetricCell label="Son Event" value={formatRelative(report.overview.lastSeenAt)} detail={formatDateTime(lastUpdatedAt)} />
                            </div>
                        </section>

                        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                            <div className="space-y-5">
                                <section className="overflow-hidden rounded-[28px] border border-border-subtle bg-bg-secondary/80 shadow-[0_16px_40px_rgba(17,17,17,0.05)]">
                                    <div className="flex items-center justify-between border-b border-border-subtle px-4 py-4">
                                        <div>
                                            <h2 className="text-[22px] font-black tracking-tight">Aktif ziyaretciler</h2>
                                            <div className="text-sm text-text-secondary">{report.overview.activeWindowMinutes} dk pencere</div>
                                        </div>
                                        <div className="rounded-full border border-border-subtle bg-bg-primary px-3 py-1 text-sm font-semibold text-text-secondary">
                                            {formatNumber(report.activeVisitors.length)}
                                        </div>
                                    </div>

                                    {report.activeVisitors.length === 0 ? (
                                        <div className="px-4 py-5 text-sm text-text-secondary">Aktif oturum yok.</div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full text-sm">
                                                <thead className="bg-bg-primary/70 text-left text-[11px] uppercase tracking-[0.14em] text-text-muted">
                                                    <tr>
                                                        <th className="px-4 py-3">User</th>
                                                        <th className="px-4 py-3">Son</th>
                                                        <th className="px-4 py-3">IP</th>
                                                        <th className="px-4 py-3">Konum</th>
                                                        <th className="px-4 py-3">Cihaz</th>
                                                        <th className="px-4 py-3">Path</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-border-subtle">
                                                    {report.activeVisitors.map((visitor) => (
                                                        <tr key={`${visitor.userId}-${visitor.sessionId}`} className="align-top">
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-2">
                                                                    <Link to={`/users/${visitor.username}`} className="font-bold text-text-primary hover:underline">
                                                                        @{visitor.username}
                                                                    </Link>
                                                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusClasses(visitor.status)}`}>
                                                                        {formatStatus(visitor.status)}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-text-secondary">{formatRelative(visitor.lastSeenAt)}</td>
                                                            <td className="px-4 py-3 font-mono text-[12px] text-text-primary">{formatIp(visitor)}</td>
                                                            <td className="px-4 py-3 text-text-secondary">{formatLocation(visitor)}</td>
                                                            <td className="px-4 py-3 text-text-secondary">{formatDevice(visitor)}</td>
                                                            <td className="px-4 py-3 font-mono text-[12px] text-text-secondary">{formatPath(visitor)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </section>

                                <section className="overflow-hidden rounded-[28px] border border-border-subtle bg-bg-secondary/80 shadow-[0_16px_40px_rgba(17,17,17,0.05)]">
                                    <div className="flex items-center justify-between border-b border-border-subtle px-4 py-4">
                                        <div>
                                            <h2 className="text-[22px] font-black tracking-tight">Oturum akisi</h2>
                                            <div className="text-sm text-text-secondary">En son hareket eden oturumlar</div>
                                        </div>
                                        {error ? <div className="text-sm text-red-500">{error}</div> : null}
                                    </div>

                                    {report.recentVisitors.length === 0 ? (
                                        <div className="px-4 py-5 text-sm text-text-secondary">Oturum yok.</div>
                                    ) : (
                                        <div className="divide-y divide-border-subtle">
                                            {report.recentVisitors.map((visitor) => (
                                                <article key={`${visitor.userId}-${visitor.sessionId}`} className="px-4 py-4">
                                                    <div className="grid gap-3 xl:grid-cols-[180px_90px_160px_180px_280px_minmax(0,1fr)]">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <Link to={`/users/${visitor.username}`} className="font-bold text-text-primary hover:underline">
                                                                    @{visitor.username}
                                                                </Link>
                                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusClasses(visitor.status)}`}>
                                                                    {formatStatus(visitor.status)}
                                                                </span>
                                                            </div>
                                                            <div className="mt-1 text-xs text-text-secondary">
                                                                Ilk {formatDateTime(visitor.firstSeenAt)}
                                                            </div>
                                                        </div>

                                                        <div className="text-sm text-text-secondary">
                                                            <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">Son</div>
                                                            <div className="mt-1 font-medium text-text-primary">{formatRelative(visitor.lastSeenAt)}</div>
                                                            <div className="mt-1 text-xs">{formatDateTime(visitor.lastSeenAt)}</div>
                                                        </div>

                                                        <div className="text-sm text-text-secondary">
                                                            <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">IP / Konum</div>
                                                            <div className="mt-1 font-mono text-[12px] text-text-primary">{formatIp(visitor)}</div>
                                                            <div className="mt-1">{formatLocation(visitor)}</div>
                                                        </div>

                                                        <div className="text-sm text-text-secondary">
                                                            <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">Cihaz</div>
                                                            <div className="mt-1 text-text-primary">{formatDevice(visitor)}</div>
                                                            <div className="mt-1 text-xs">{formatNumber(visitor.eventCount)} event</div>
                                                        </div>

                                                        <div className="text-sm text-text-secondary">
                                                            <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">Session / Path</div>
                                                            <div className="mt-1 break-all font-mono text-[12px] text-text-primary">{visitor.sessionId}</div>
                                                            <div className="mt-1 break-all font-mono text-[12px]">{formatPath(visitor)}</div>
                                                        </div>

                                                        <div className="text-sm text-text-secondary">
                                                            <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">User-Agent</div>
                                                            <div className="mt-1 break-all text-text-primary">{visitor.userAgent ?? '-'}</div>
                                                            {(visitor.host || visitor.referer) ? (
                                                                <div className="mt-2 space-y-1 text-xs">
                                                                    <div className="break-all">Host: {visitor.host ?? '-'}</div>
                                                                    <div className="break-all">Ref: {visitor.referer ?? '-'}</div>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </article>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </div>

                            <aside className="space-y-5">
                                <DistributionCard title="Konum" buckets={topLocationBuckets(report)} />
                                <DistributionCard title="Cihaz" buckets={report.devices.deviceTypes} />
                                <DistributionCard title="Isletim Sistemleri" buckets={report.devices.operatingSystems} />
                                <DistributionCard title="Tarayicilar" buckets={report.devices.browsers} />
                            </aside>
                        </div>
                    </>
                ) : (
                    <div className="rounded-[28px] border border-border-subtle bg-bg-secondary p-5 text-sm text-text-secondary">
                        Rapor gelmedi.
                    </div>
                )}
            </div>
        </div>
    );
}
