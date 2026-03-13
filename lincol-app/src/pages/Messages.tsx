import { DeferredGifPicker } from '../components/ui/DeferredGifPicker';
import { ConversationComposer } from '../features/messages/components/ConversationComposer';
import { MessagesSidebar } from '../features/messages/components/MessagesSidebar';
import { MessagesThreadHeader } from '../features/messages/components/MessagesThreadHeader';
import { MessagesThreadPlaceholder } from '../features/messages/components/MessagesThreadPlaceholder';
import { MessagesThreadViewport } from '../features/messages/components/MessagesThreadViewport';
import { useMessagesController } from '../features/messages/useMessagesController';

export function Messages() {
    const {
        activeConversation,
        activeConversationId,
        applySelectedFile,
        canSubmitMessage,
        clearComposerAttachment,
        closeGifPicker,
        composerAttachment,
        composerDockRef,
        composerError,
        composerRef,
        composerText,
        conversations,
        counterpartyTyping,
        currentUser,
        fileInputRef,
        friends,
        goToMessagesList,
        goToProfile,
        handleComposerBlur,
        handleComposerFocus,
        handleComposerKeyDown,
        handleComposerTextChange,
        handleGifSelect,
        handleOpenConversation,
        handleSend,
        hasActiveThread,
        hasMoreOlder,
        isGifPickerOpen,
        loadOlderMessages,
        loadingConversations,
        loadingFriends,
        loadingOlder,
        loadingThread,
        messages,
        mobileComposerHeight,
        mobileComposerLift,
        openFilePicker,
        openGifPicker,
        routeUsername,
        searchQuery,
        searchResults,
        searching,
        setSearchQuery,
        showSearchResults,
        syncingLatest,
        threadError,
        threadScrollRef,
        unreadCount,
        validatingAttachment,
    } = useMessagesController();

    return (
        <div
            className={`mx-auto flex w-full overflow-hidden md:h-[100dvh] md:rounded-[18px] md:border md:border-[#d9dee3] dark:md:border-[#20343d] ${
                hasActiveThread
                    ? 'h-[100dvh]'
                    : 'h-[calc(100dvh-var(--mobile-header-offset)-var(--mobile-tabbar-offset)-env(safe-area-inset-bottom))]'
            } ${
                hasActiveThread ? 'bg-[#f3ebe4] dark:bg-[#050608]' : 'bg-[#f5eee8] dark:bg-[#07080b]'
            }`}
        >
            <MessagesSidebar
                hasActiveThread={hasActiveThread}
                unreadCount={unreadCount}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                showSearchResults={showSearchResults}
                searching={searching}
                searchResults={searchResults}
                friends={friends}
                loadingFriends={loadingFriends}
                conversations={conversations}
                loadingConversations={loadingConversations}
                activeConversationId={activeConversationId}
                routeUsername={routeUsername}
                currentUserId={currentUser?.id}
                onOpenConversation={handleOpenConversation}
            />

            <section className={`${hasActiveThread ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col bg-[#f3ebe4] dark:bg-[#050608]`}>
                {hasActiveThread ? (
                    <>
                        <MessagesThreadHeader
                            activeConversation={activeConversation}
                            counterpartyTyping={counterpartyTyping}
                            syncingLatest={syncingLatest}
                            onBack={goToMessagesList}
                            onOpenProfile={goToProfile}
                        />

                        <MessagesThreadViewport
                            viewportRef={threadScrollRef}
                            activeConversation={activeConversation}
                            messages={messages}
                            currentUserId={currentUser?.id}
                            counterpartyTyping={counterpartyTyping}
                            loadingThread={loadingThread}
                            threadError={threadError}
                            loadingOlder={loadingOlder}
                            hasMoreOlder={hasMoreOlder}
                            mobileComposerHeight={mobileComposerHeight}
                            mobileComposerLift={mobileComposerLift}
                            onLoadOlder={() => void loadOlderMessages()}
                        />

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,video/*"
                            className="hidden"
                            onChange={(event) => {
                                void applySelectedFile(event.target.files?.[0] ?? null);
                            }}
                        />

                        <ConversationComposer
                            variant="mobile"
                            formRef={composerDockRef}
                            textareaRef={composerRef}
                            composerError={composerError}
                            composerAttachment={composerAttachment}
                            validatingAttachment={validatingAttachment}
                            canMessage={Boolean(activeConversation?.canMessage)}
                            hasConversation={Boolean(activeConversation)}
                            composerText={composerText}
                            canSubmitMessage={canSubmitMessage}
                            mobileComposerLift={mobileComposerLift}
                            onSubmit={handleSend}
                            onClearAttachment={clearComposerAttachment}
                            onOpenFilePicker={openFilePicker}
                            onOpenGifPicker={openGifPicker}
                            onTextChange={handleComposerTextChange}
                            onKeyDown={handleComposerKeyDown}
                            onFocus={handleComposerFocus}
                            onBlur={handleComposerBlur}
                        />

                        <ConversationComposer
                            variant="desktop"
                            composerError={composerError}
                            composerAttachment={composerAttachment}
                            validatingAttachment={validatingAttachment}
                            canMessage={Boolean(activeConversation?.canMessage)}
                            hasConversation={Boolean(activeConversation)}
                            composerText={composerText}
                            canSubmitMessage={canSubmitMessage}
                            onSubmit={handleSend}
                            onClearAttachment={clearComposerAttachment}
                            onOpenFilePicker={openFilePicker}
                            onOpenGifPicker={openGifPicker}
                            onTextChange={handleComposerTextChange}
                            onKeyDown={handleComposerKeyDown}
                            onFocus={handleComposerFocus}
                            onBlur={handleComposerBlur}
                        />

                        {isGifPickerOpen ? (
                            <DeferredGifPicker
                                onClose={closeGifPicker}
                                onSelect={handleGifSelect}
                            />
                        ) : null}
                    </>
                ) : (
                    <MessagesThreadPlaceholder />
                )}
            </section>
        </div>
    );
}
