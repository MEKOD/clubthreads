import { Loader2 } from 'lucide-react';
import { PostCard } from '../components/feed/PostCard';
import { RepostComposerSheet } from '../components/feed/RepostComposerSheet';
import { HomeFeedTabs } from '../components/home/HomeFeedTabs';
import { useHomeFeedController } from '../hooks/useHomeFeedController';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

export function Home() {
    const {
        activeTab,
        setActiveTab,
        displayPosts,
        displayLoading,
        isLoadingMore,
        activeNextCursor,
        repostTarget,
        quoteText,
        setQuoteText,
        quoteGif,
        setQuoteGif,
        isQuoteGifPickerOpen,
        setIsQuoteGifPickerOpen,
        isSubmittingRepost,
        composePostedPreview,
        canShowNotifCTA,
        notifHint,
        isEnablingNotif,
        ptrProgress,
        isRefreshingFeed,
        loadMoreSentinelRef,
        handleInteract,
        handleShare,
        handleRepost,
        handleEnableNotifications,
        openCompose,
        closeRepostDialog,
        submitRepost,
        refreshActiveFeed,
    } = useHomeFeedController();

    useBodyScrollLock(Boolean(repostTarget));


    return (
        <div className="mx-auto min-h-screen max-w-[600px] border-x border-border">

            {(ptrProgress > 0 || isRefreshingFeed) && (
                <div
                    className="pointer-events-none fixed left-1/2 top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top)-2px)] z-50 -translate-x-1/2 transition-all duration-200"
                    style={{ opacity: isRefreshingFeed ? 1 : Math.min(ptrProgress / 48, 1) }}
                >
                    <div className="flex items-center gap-2 rounded-full border border-border-subtle bg-bg-primary/94 px-3 py-1.5 shadow-[0_10px_24px_rgba(17,17,17,0.1)] backdrop-blur">
                        <Loader2
                            size={16}
                            className={isRefreshingFeed ? 'animate-spin text-brand' : 'text-text-secondary'}
                            style={isRefreshingFeed ? undefined : { transform: `rotate(${ptrProgress * 5}deg)` }}
                        />
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                            {isRefreshingFeed ? 'Yenileniyor' : 'Asagi cek'}
                        </span>
                    </div>
                </div>
            )}

            <RepostComposerSheet
                open={Boolean(repostTarget)}
                target={repostTarget}
                quoteText={quoteText}
                onQuoteTextChange={setQuoteText}
                quoteGif={quoteGif}
                onQuoteGifChange={setQuoteGif}
                gifPickerOpen={isQuoteGifPickerOpen}
                onGifPickerOpenChange={setIsQuoteGifPickerOpen}
                isSubmitting={isSubmittingRepost}
                onClose={closeRepostDialog}
                onSubmit={submitRepost}
            />

            {composePostedPreview && (
                <div className="fixed left-1/2 top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top)+0.75rem)] z-[75] w-[min(92vw,520px)] -translate-x-1/2 rounded-2xl border border-border-subtle bg-bg-primary/95 px-4 py-3 shadow-[0_18px_50px_rgba(17,17,17,0.16)] backdrop-blur md:top-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">Post gonderildi</div>
                    <p className="mt-1 line-clamp-2 text-sm font-medium text-text-primary">
                        {composePostedPreview.content || (composePostedPreview.mediaUrl ? 'Medyali post paylasildi.' : 'Yeni post paylasildi.')}
                    </p>
                    {canShowNotifCTA && (
                        <button
                            type="button"
                            onClick={handleEnableNotifications}
                            disabled={isEnablingNotif}
                            className="mt-2 rounded-full bg-text-primary px-3.5 py-1.5 text-xs font-semibold text-inverse-primary disabled:opacity-60"
                        >
                            {isEnablingNotif ? 'Aciliyor...' : 'Bildirimleri Ac'}
                        </button>
                    )}
                    {notifHint && <p className="mt-2 text-[11px] leading-5 text-text-muted">{notifHint}</p>}
                </div>
            )}

            <HomeFeedTabs activeTab={activeTab} onChange={setActiveTab} />

            <div>
                {displayLoading && displayPosts.length === 0 ? (
                    <div className="flex justify-center border-b border-border py-8 text-[15px] text-text-secondary">
                        {activeTab === 'for_you' ? 'Sana ozel akisi yukleniyor...' : 'Cop akisi yukleniyor...'}
                    </div>
                ) : displayPosts.length === 0 ? (
                    <div className="px-8 py-12 text-center">
                        <div className="text-[20px] font-extrabold text-text-primary">
                            {activeTab === 'for_you' ? 'Sana ozel akista henuz bir sey yok.' : 'Cop akisi henuz bos.'}
                        </div>
                        <p className="mt-2 text-[15px] text-text-secondary">
                            {activeTab === 'for_you' ? 'Biraz daha gezin, begen ve cevap ver. Akis hizla oturur.' : 'Daha fazla kaos biriksin.'}
                        </p>
                    </div>
                ) : (
                    <>
                        {displayPosts.map((post) => (
                            <PostCard
                                key={post.id}
                                post={post}
                                feedMode={activeTab}
                                onInteract={handleInteract}
                                onRepost={handleRepost}
                                onShare={handleShare}
                                onReply={() => void refreshActiveFeed()}
                            />
                        ))}

                        {/* Infinite scroll sentinel */}
                        {activeNextCursor && (
                            <div ref={loadMoreSentinelRef} className="flex justify-center py-6">
                                {isLoadingMore && (
                                    <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Mobile FAB compose button */}
            <button
                type="button"
                onClick={openCompose}
                aria-label="Post olustur"
                className="fixed bottom-[calc(var(--mobile-tabbar-offset)+env(safe-area-inset-bottom)+1rem)] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-text-primary text-inverse-primary shadow-lg transition-transform active:scale-95 md:hidden"
            >
                <span className="pointer-events-none select-none text-[34px] leading-none">+</span>
            </button>
        </div>
    );
}
