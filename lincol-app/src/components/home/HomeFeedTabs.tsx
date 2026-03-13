type FeedTab = 'for_you' | 'latest' | 'trash';

export function HomeFeedTabs({
    activeTab,
    onChange,
}: {
    activeTab: FeedTab;
    onChange: (tab: FeedTab) => void;
}) {
    return (
        <div className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top))] z-10 border-b border-border bg-bg-primary/85 backdrop-blur-md md:top-0">
            <div className="grid grid-cols-2">
                {(['for_you', 'trash'] as const).map((tab) => {
                    const isActive = activeTab === tab;
                    const label = tab === 'for_you' ? 'Sana Özel' : 'Çöp';
                    return (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => onChange(tab)}
                            className={`relative py-4 text-[15px] font-bold transition-colors hover:bg-bg-hover ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}
                        >
                            {label}
                            {isActive && (
                                <span className="absolute bottom-0 left-1/2 h-[4px] w-14 -translate-x-1/2 rounded-full bg-brand" />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
