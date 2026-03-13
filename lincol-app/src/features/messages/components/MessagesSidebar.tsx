import { Loader2, Lock, MessageCircle, Search } from 'lucide-react';
import { getAvatarUrl } from '../../../lib/axios';
import type { DirectConversationSummary, DirectFriend } from '../../../lib/social';
import { VerifiedBadge } from '../../../components/ui/VerifiedBadge';
import type { SearchUser } from '../types';
import { buildConversationPreview, formatConversationTimestamp } from '../utils';

interface MessagesSidebarProps {
    hasActiveThread: boolean;
    unreadCount: number;
    searchQuery: string;
    onSearchQueryChange: (value: string) => void;
    showSearchResults: boolean;
    searching: boolean;
    searchResults: SearchUser[];
    friends: DirectFriend[];
    loadingFriends: boolean;
    conversations: DirectConversationSummary[];
    loadingConversations: boolean;
    activeConversationId?: string;
    routeUsername?: string;
    currentUserId?: string;
    onOpenConversation: (username: string) => void;
}

export function MessagesSidebar({
    hasActiveThread,
    unreadCount,
    searchQuery,
    onSearchQueryChange,
    showSearchResults,
    searching,
    searchResults,
    friends,
    loadingFriends,
    conversations,
    loadingConversations,
    activeConversationId,
    routeUsername,
    currentUserId,
    onOpenConversation,
}: MessagesSidebarProps) {
    const quickFriends = friends.slice(0, 10);

    return (
        <aside
            className={`${hasActiveThread ? 'hidden md:flex' : 'flex'} min-w-0 w-full flex-col bg-[#f5eee8] md:w-[420px] md:shrink-0 md:border-r md:border-[#ddcec2] dark:bg-[#07080b] dark:md:border-[#1b1f27]`}
        >
            <div className="bg-[#7f5c49] text-white shadow-[0_10px_30px_rgba(127,92,73,0.2)] dark:bg-[#101218] dark:shadow-[0_10px_30px_rgba(0,0,0,0.38)]">
                <div className="px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.7rem)] md:px-5 md:pb-3 md:pt-4">
                    <div className="flex items-center gap-3">
                        <label className="flex flex-1 items-center gap-2 rounded-full bg-white/14 px-4 py-2.5 text-white/88 ring-1 ring-white/10 backdrop-blur-sm transition focus-within:bg-[#fffaf7] focus-within:text-[#2f2823] focus-within:ring-white/0 dark:bg-[#171a22] dark:text-[#d8dbe2] dark:focus-within:bg-[#0b0d12] dark:focus-within:text-white">
                            <Search size={17} className="shrink-0 opacity-70" />
                            <input
                                value={searchQuery}
                                onChange={(event) => onSearchQueryChange(event.target.value)}
                                placeholder="Kisi, kullanici adi veya sohbet ara"
                                className="w-full bg-transparent text-[14px] outline-none placeholder:text-inherit placeholder:opacity-60"
                            />
                        </label>
                        <div className="rounded-full border border-white/14 bg-white/12 px-3 py-1.5 text-[12px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                            {unreadCount > 0 ? `${unreadCount} okunmamis` : 'Temiz'}
                        </div>
                    </div>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {showSearchResults ? (
                    <section className="px-3 pb-8 pt-4 md:px-4">
                        <div className="mb-3 px-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#7c6657] dark:text-[#8c93a3]">
                            Yeni sohbet
                        </div>

                        {searching ? (
                            <div className="flex items-center justify-center py-16 text-[#7c6657] dark:text-[#8c93a3]">
                                <Loader2 className="h-6 w-6 animate-spin" />
                            </div>
                        ) : searchResults.length === 0 ? (
                            <div className="rounded-[24px] border border-[#ddcec2] bg-[#fffaf7] px-5 py-8 text-center shadow-[0_8px_24px_rgba(70,46,31,0.06)] dark:border-[#1b1f27] dark:bg-[#0d0f14] dark:shadow-none">
                                <div className="text-lg font-semibold text-[#2f2823] dark:text-[#f1f3f7]">Eslesme yok</div>
                                <p className="mt-2 text-sm leading-6 text-[#7c6657] dark:text-[#8c93a3]">
                                    Sadece karsilikli takipte oldugun kisiler burada gorunur.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-[22px] border border-[#ddcec2] bg-[#fffaf7] shadow-[0_12px_28px_rgba(70,46,31,0.05)] dark:border-[#1b1f27] dark:bg-[#0d0f14] dark:shadow-none">
                                {searchResults.slice(0, 8).map((user) => (
                                    <button
                                        key={user.id}
                                        type="button"
                                        onClick={() => onOpenConversation(user.username)}
                                        className="flex w-full items-center gap-3 border-b border-[#efe1d7] px-4 py-3.5 text-left transition hover:bg-[#f4ece6] last:border-b-0 dark:border-[#1b1f27] dark:hover:bg-[#141821]"
                                    >
                                        <img
                                            src={getAvatarUrl(user.username, user.profilePic)}
                                            alt={user.username}
                                            className="h-12 w-12 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/8"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <div className="truncate text-[15px] font-semibold text-[#2f2823] dark:text-[#f1f3f7]">
                                                    @{user.username}
                                                </div>
                                                <VerifiedBadge role={user.role} size={16} />
                                            </div>
                                            <p className="mt-1 line-clamp-1 text-sm text-[#7c6657] dark:text-[#8c93a3]">
                                                {user.bio || `${user.handle} ile konusmaya basla`}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                ) : (
                    <>
                        <section className="border-b border-[#ddcec2] px-3 py-4 dark:border-[#1b1f27] md:px-4">
                            <div className="mb-3 flex items-center justify-between px-1">
                                <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#7c6657] dark:text-[#8c93a3]">
                                    Hizli baslat
                                </div>
                                <div className="text-xs font-semibold text-[#7c6657] dark:text-[#8c93a3]">
                                    {friends.length}
                                </div>
                            </div>

                            {loadingFriends ? (
                                <div className="flex items-center justify-center py-10 text-[#7c6657] dark:text-[#8c93a3]">
                                    <Loader2 className="h-6 w-6 animate-spin" />
                                </div>
                            ) : friends.length === 0 ? (
                                <div className="rounded-[20px] border border-dashed border-[#d5c0b1] bg-[#fffaf7] px-5 py-6 text-center dark:border-[#262b34] dark:bg-[#0d0f14]">
                                    <div className="text-[15px] font-semibold text-[#2f2823] dark:text-[#f1f3f7]">Hizli baslat listesi bos</div>
                                    <p className="mt-2 text-sm leading-6 text-[#7c6657] dark:text-[#8c93a3]">
                                        Karsilikli takip oldugunda kisiler otomatik olarak buraya gelir.
                                    </p>
                                </div>
                            ) : (
                                <div className="flex gap-3 overflow-x-auto px-1 pb-1">
                                    {quickFriends.map((friend) => (
                                        <button
                                            key={friend.userId}
                                            type="button"
                                            onClick={() => onOpenConversation(friend.username)}
                                            className="group min-w-[86px] text-center"
                                        >
                                            <div className="relative mx-auto h-16 w-16">
                                                <img
                                                    src={getAvatarUrl(friend.username, friend.profilePic)}
                                                    alt={friend.username}
                                                    className="h-16 w-16 rounded-full object-cover ring-2 ring-[#fffaf7] shadow-[0_4px_12px_rgba(70,46,31,0.12)] dark:ring-[#07080b] dark:shadow-none"
                                                />
                                                {friend.unreadCount > 0 ? (
                                                    <span className="absolute -right-1 -top-1 flex h-6 min-w-[24px] items-center justify-center rounded-full bg-[#45a9cf] px-1 text-[11px] font-bold text-white ring-2 ring-[#f5eee8] dark:bg-[#4f86ff] dark:ring-[#07080b]">
                                                        {friend.unreadCount > 9 ? '9+' : friend.unreadCount}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="mt-2 truncate text-[13px] font-semibold text-[#2f2823] dark:text-[#f1f3f7]">
                                                @{friend.username}
                                            </div>
                                            <div className="mt-0.5 truncate text-[11px] text-[#7c6657] dark:text-[#8c93a3]">
                                                {friend.conversationId ? 'Devam et' : 'Yeni'}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section className="min-h-0 flex-1 px-0 pb-8 pt-3">
                            <div className="mb-2 flex items-center justify-between px-4">
                                <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#7c6657] dark:text-[#8c93a3]">
                                    Sohbetlerin
                                </div>
                                <div className="text-xs font-semibold text-[#7c6657] dark:text-[#8c93a3]">
                                    {conversations.length}
                                </div>
                            </div>

                            {loadingConversations ? (
                                <div className="flex items-center justify-center py-14 text-[#7c6657] dark:text-[#8c93a3]">
                                    <Loader2 className="h-6 w-6 animate-spin" />
                                </div>
                            ) : conversations.length === 0 ? (
                                <div className="mx-3 rounded-[28px] border border-[#ddcec2] bg-[#fffaf7] px-6 py-10 text-center shadow-[0_10px_28px_rgba(70,46,31,0.05)] dark:border-[#1b1f27] dark:bg-[#0d0f14] dark:shadow-none">
                                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#dceff6] text-[#3a9fc8] dark:bg-[#18233a] dark:text-[#74a4ff]">
                                        <MessageCircle size={24} />
                                    </div>
                                    <div className="mt-5 text-[28px] font-black tracking-[-0.04em] text-[#2f2823] dark:text-[#f1f3f7]">
                                        Inbox bos
                                    </div>
                                    <p className="mt-3 text-sm leading-7 text-[#7c6657] dark:text-[#8c93a3]">
                                        Profildeki Mesaj butonundan ya da yukaridaki aramadan yeni bir sohbet ac.
                                    </p>
                                </div>
                            ) : (
                                <div className="overflow-hidden bg-transparent">
                                    {conversations.map((conversation) => {
                                        const isActive =
                                            conversation.id === activeConversationId
                                            || conversation.otherUsername === routeUsername;
                                        const preview = buildConversationPreview(conversation.lastMessage, currentUserId);

                                        return (
                                            <button
                                                key={conversation.id}
                                                type="button"
                                                onClick={() => onOpenConversation(conversation.otherUsername)}
                                                className={`relative flex w-full items-center gap-3 border-b border-[#e4d6cb] px-4 py-3 text-left transition last:border-b-0 hover:bg-[#fbf5f0] dark:border-[#1b1f27] dark:hover:bg-[#11141b] ${
                                                    isActive
                                                        ? 'bg-[#dceef6] dark:bg-[#11182a]'
                                                        : 'bg-transparent'
                                                }`}
                                            >
                                                <img
                                                    src={getAvatarUrl(conversation.otherUsername, conversation.otherProfilePic)}
                                                    alt={conversation.otherUsername}
                                                    className="h-12 w-12 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/8"
                                                />

                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <div className="truncate text-[16px] font-semibold text-[#2f2823] dark:text-[#f1f3f7]">
                                                            @{conversation.otherUsername}
                                                        </div>
                                                        <VerifiedBadge role={conversation.otherRole} size={16} />
                                                        <div className={`ml-auto shrink-0 text-[12px] ${
                                                            conversation.unreadCount > 0
                                                                ? 'font-semibold text-[#3a9fc8] dark:text-[#74a4ff]'
                                                                : 'text-[#7c6657] dark:text-[#8c93a3]'
                                                        }`}>
                                                            {formatConversationTimestamp(conversation.lastMessage?.createdAt ?? conversation.lastMessageAt)}
                                                        </div>
                                                    </div>

                                                    <div className="mt-1 flex items-center gap-2">
                                                        {!conversation.canMessage ? (
                                                            <Lock size={12} className="shrink-0 text-[#7c6657] dark:text-[#8c93a3]" />
                                                        ) : null}
                                                        <p className={`min-w-0 flex-1 truncate text-[13px] ${
                                                            conversation.unreadCount > 0
                                                                ? 'font-semibold text-[#2f2823] dark:text-[#f1f3f7]'
                                                                : 'text-[#7c6657] dark:text-[#8c93a3]'
                                                        }`}>
                                                            {preview}
                                                        </p>
                                                        {conversation.unreadCount > 0 ? (
                                                            <span className="inline-flex min-w-[22px] shrink-0 items-center justify-center rounded-full bg-[#45a9cf] px-1.5 py-0.5 text-[11px] font-bold text-white dark:bg-[#4f86ff]">
                                                                {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    </>
                )}
            </div>
        </aside>
    );
}
