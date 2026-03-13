import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { QuickComposer } from '../components/feed/QuickComposer';
import { RepostComposerSheet } from '../components/feed/RepostComposerSheet';
import { api, toAbsoluteUrl } from '../lib/axios';
import type { CommunityDetail, CommunityJoinRequest, CommunityMember, CommunityRule } from '../lib/social';
import { useCommunityStore } from '../store/communityStore';
import { useAuthStore } from '../store/authStore';
import { CommunityFeedTab } from '../components/community/CommunityFeedTab';
import { CommunityHeader } from '../components/community/CommunityHeader';
import { CommunityManageTab } from '../components/community/CommunityManageTab';
import { CommunityMembersTab } from '../components/community/CommunityMembersTab';
import { CommunityRulesTab } from '../components/community/CommunityRulesTab';
import { useCommunityFeedController } from '../hooks/useCommunityFeedController';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { trackAnalyticsEvent } from '../lib/analytics';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

type CommunityTab = 'latest' | 'members' | 'rules' | 'manage';

interface ModerationInvite {
    userId: string;
    username: string;
    profilePic: string | null;
    bio: string | null;
    invitedAt: string;
}

export function CommunityDetailPage() {
    const { slug = '' } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const setLastVisitedCommunitySlug = useCommunityStore((state) => state.setLastVisitedCommunitySlug);
    const clearLastVisitedCommunitySlug = useCommunityStore((state) => state.clearLastVisitedCommunitySlug);
    const bumpMembershipVersion = useCommunityStore((state) => state.bumpMembershipVersion);
    const [selectedCommunity, setSelectedCommunity] = useState<CommunityDetail | null>(null);
    const [members, setMembers] = useState<CommunityMember[]>([]);
    const [rules, setRules] = useState<CommunityRule[]>([]);
    const [pendingRequests, setPendingRequests] = useState<CommunityJoinRequest[]>([]);
    const [invites, setInvites] = useState<ModerationInvite[]>([]);
    const [loadingDetail, setLoadingDetail] = useState(true);
    const [joinLoading, setJoinLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<CommunityTab>('latest');
    const [inviteUsername, setInviteUsername] = useState('');
    const [inviteLoading, setInviteLoading] = useState(false);
    const [requestActionUserId, setRequestActionUserId] = useState<string | null>(null);
    const [roleActionUserId, setRoleActionUserId] = useState<string | null>(null);
    const [ruleSaving, setRuleSaving] = useState(false);
    const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
    const [manageSaving, setManageSaving] = useState(false);
    const [manageDeleting, setManageDeleting] = useState(false);
    const [manageAvatarPreviewUrl, setManageAvatarPreviewUrl] = useState<string | null>(null);
    const [manageAvatarFile, setManageAvatarFile] = useState<File | null>(null);
    const avatarInputRef = useRef<HTMLInputElement | null>(null);
    const lastTrackedCommunityViewRef = useRef<string | null>(null);
    const [manageForm, setManageForm] = useState({
        name: '',
        description: '',
        bannerUrl: '',
        isPrivate: false,
    });

    const loadCommunityDetail = async () => {
        if (!slug) return;

        setLoadingDetail(true);
        try {
            const communityResponse = await api.get(`/communities/${slug}`);
            const community = communityResponse.data.community as CommunityDetail;
            setSelectedCommunity(community);
            setRules(communityResponse.data.rules ?? []);
            setManageForm({
                name: community.name,
                description: community.description ?? '',
                bannerUrl: community.bannerUrl ?? '',
                isPrivate: community.isPrivate,
            });
            setManageAvatarPreviewUrl(toAbsoluteUrl(community.avatarUrl));
            setManageAvatarFile(null);
            setLastVisitedCommunitySlug(community.slug);

            const membersResponse = await api.get(`/communities/${slug}/members`);
            setMembers(membersResponse.data.members ?? []);

            if (community.permissions?.canModerate) {
                const [requestsResponse, invitesResponse] = await Promise.all([
                    api.get(`/communities/${slug}/requests`).catch(() => ({ data: { requests: [] } })),
                    api.get(`/communities/${slug}/invites`).catch(() => ({ data: { invites: [] } })),
                ]);
                setPendingRequests(requestsResponse.data.requests ?? []);
                setInvites(invitesResponse.data.invites ?? []);
            } else {
                setPendingRequests([]);
                setInvites([]);
            }
        } catch (error) {
            console.error('Community detail load failed', error);
            setSelectedCommunity(null);
            setRules([]);
            setMembers([]);
            setPendingRequests([]);
            setInvites([]);
            navigate('/communities?hub=1', { replace: true });
        } finally {
            setLoadingDetail(false);
        }
    };

    useEffect(() => {
        void loadCommunityDetail();
    }, [slug]);

    useEffect(() => {
        if (!slug) {
            return;
        }

        const normalizedSlug = slug.toLowerCase();
        if (lastTrackedCommunityViewRef.current === normalizedSlug) {
            return;
        }

        lastTrackedCommunityViewRef.current = normalizedSlug;
        trackAnalyticsEvent({
            eventType: 'community_view',
            surface: 'community_page',
            entityType: 'community',
            entityId: normalizedSlug,
        });
    }, [slug]);

    const {
        setFeedMode,
        displayPosts,
        displayLoading,
        isLoadingMore,
        activeNextCursor,
        loadMoreSentinelRef,
        handleInteract,
        handleShare,
        handleRepost,
        repostTarget,
        quoteText,
        setQuoteText,
        quoteGif,
        setQuoteGif,
        isQuoteGifPickerOpen,
        setIsQuoteGifPickerOpen,
        isSubmittingRepost,
        closeRepostDialog,
        submitRepost,
        prependPost,
    } = useCommunityFeedController({
        slug,
        communityId: selectedCommunity?.id,
        communityName: selectedCommunity?.name,
    });

    const navState = (location.state ?? {}) as { scrollY?: number };

    useScrollRestoration({
        storageKey: `community-scroll:${slug}:${activeTab}`,
        ready: !loadingDetail && (activeTab !== 'latest' || !displayLoading),
        contentKey: `${activeTab}:${loadingDetail ? 'loading' : 'ready'}:${displayLoading ? 'loading' : 'ready'}`,
        initialScrollY: navState.scrollY ?? null,
    });

    useBodyScrollLock(Boolean(repostTarget));

    const handleInvite = async () => {
        if (!selectedCommunity || !inviteUsername.trim()) return;
        setInviteLoading(true);
        try {
            await api.post(`/communities/${selectedCommunity.slug}/invites`, {
                username: inviteUsername.trim().replace(/^@/, ''),
            });
            setInviteUsername('');
            await loadCommunityDetail();
        } catch (error) {
            console.error('Invite failed', error);
        } finally {
            setInviteLoading(false);
        }
    };

    const handleRequestApproval = async (requestUserId: string, action: 'approve' | 'reject') => {
        if (!selectedCommunity) return;
        setRequestActionUserId(requestUserId);
        try {
            if (action === 'approve') {
                await api.post(`/communities/${selectedCommunity.slug}/requests/${requestUserId}/approve`);
            } else {
                await api.delete(`/communities/${selectedCommunity.slug}/requests/${requestUserId}`);
            }
            await loadCommunityDetail();
        } catch (error) {
            console.error('Request action failed', error);
        } finally {
            setRequestActionUserId(null);
        }
    };

    const handleRoleChange = async (memberUserId: string, role: 'moderator' | 'member') => {
        if (!selectedCommunity) return;
        setRoleActionUserId(memberUserId);
        try {
            await api.patch(`/communities/${selectedCommunity.slug}/members/${memberUserId}/role`, { role });
            await loadCommunityDetail();
        } catch (error) {
            console.error('Role update failed', error);
        } finally {
            setRoleActionUserId(null);
        }
    };

    const handleCreateRule = async (payload: { title: string; description: string }) => {
        if (!selectedCommunity) return;
        setRuleSaving(true);
        try {
            await api.post(`/communities/${selectedCommunity.slug}/rules`, payload);
            await loadCommunityDetail();
        } catch (error) {
            console.error('Rule create failed', error);
        } finally {
            setRuleSaving(false);
        }
    };

    const handleUpdateRule = async (ruleId: string, payload: { title: string; description: string }) => {
        if (!selectedCommunity) return;
        setRuleSaving(true);
        try {
            await api.patch(`/communities/${selectedCommunity.slug}/rules/${ruleId}`, payload);
            await loadCommunityDetail();
        } catch (error) {
            console.error('Rule update failed', error);
        } finally {
            setRuleSaving(false);
        }
    };

    const handleDeleteRule = async (ruleId: string) => {
        if (!selectedCommunity) return;
        setDeletingRuleId(ruleId);
        try {
            await api.delete(`/communities/${selectedCommunity.slug}/rules/${ruleId}`);
            await loadCommunityDetail();
        } catch (error) {
            console.error('Rule delete failed', error);
        } finally {
            setDeletingRuleId(null);
        }
    };

    const handleManageSave = async () => {
        if (!selectedCommunity) return;
        setManageSaving(true);
        try {
            let avatarUrl: string | null | undefined;
            if (manageAvatarFile) {
                const formData = new FormData();
                formData.append('file', manageAvatarFile);
                const uploadResponse = await api.post('/media/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                avatarUrl = uploadResponse.data.url ?? null;
            } else if (manageAvatarPreviewUrl === null) {
                avatarUrl = null;
            }

            await api.patch(`/communities/${selectedCommunity.slug}`, {
                name: manageForm.name.trim(),
                description: manageForm.description.trim() || null,
                ...(avatarUrl !== undefined ? { avatarUrl } : {}),
                bannerUrl: manageForm.bannerUrl.trim() || null,
                isPrivate: manageForm.isPrivate,
            });
            await loadCommunityDetail();
        } catch (error) {
            console.error('Community update failed', error);
        } finally {
            setManageSaving(false);
        }
    };

    const handleManageAvatarSelect = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0] ?? null;
        if (!file) return;
        setManageAvatarFile(file);
        setManageAvatarPreviewUrl(URL.createObjectURL(file));
    };

    const handleManageAvatarRemove = () => {
        setManageAvatarFile(null);
        setManageAvatarPreviewUrl(null);
        if (avatarInputRef.current) {
            avatarInputRef.current.value = '';
        }
    };

    const handleJoinToggle = async () => {
        if (!selectedCommunity) return;

        setJoinLoading(true);
        try {
            if (selectedCommunity.isMember) {
                await api.delete(`/communities/${selectedCommunity.slug}/join`);
                bumpMembershipVersion();
                setSelectedCommunity((current) => current ? {
                    ...current,
                    isMember: false,
                    viewerRole: null,
                    memberCount: Math.max(0, current.memberCount - 1),
                    hasInvite: false,
                    hasRequestedJoin: false,
                    permissions: current.permissions ? { ...current.permissions, canPost: false } : current.permissions,
                } : current);
                return;
            }

            const response = await api.post(`/communities/${selectedCommunity.slug}/join`);
            if (response.data.requested) {
                setSelectedCommunity((current) => current ? {
                    ...current,
                    hasRequestedJoin: true,
                    hasInvite: false,
                } : current);
                return;
            }

            if (response.data.isMember) {
                bumpMembershipVersion();
                setSelectedCommunity((current) => current ? {
                    ...current,
                    isMember: true,
                    viewerRole: current.viewerRole ?? 'member',
                    memberCount: current.memberCount + 1,
                    hasInvite: false,
                    hasRequestedJoin: false,
                    permissions: current.permissions ? { ...current.permissions, canPost: true } : current.permissions,
                } : current);
                await loadCommunityDetail();
            }
        } catch (error) {
            console.error('Join/leave failed', error);
        } finally {
            setJoinLoading(false);
        }
    };

    const handleInviteReject = async () => {
        if (!selectedCommunity?.hasInvite) return;

        setJoinLoading(true);
        try {
            await api.delete(`/communities/${selectedCommunity.slug}/invites/me`);
            bumpMembershipVersion();
            if (selectedCommunity.isPrivate && !selectedCommunity.isMember) {
                navigate('/communities?hub=1', { replace: true });
                return;
            }
            setSelectedCommunity((current) => current ? {
                ...current,
                hasInvite: false,
            } : current);
        } catch (error) {
            console.error('Invite reject failed', error);
        } finally {
            setJoinLoading(false);
        }
    };

    const handleDeleteCommunity = async () => {
        if (!selectedCommunity) return;
        setManageDeleting(true);
        try {
            await api.delete(`/communities/${selectedCommunity.slug}`);
            clearLastVisitedCommunitySlug();
            navigate('/communities?hub=1', { replace: true });
        } catch (error) {
            console.error('Community delete failed', error);
        } finally {
            setManageDeleting(false);
        }
    };

    if (loadingDetail || !selectedCommunity) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            </div>
        );
    }

    const canPost = selectedCommunity.permissions?.canPost ?? selectedCommunity.isMember;
    const tabs: Array<{ id: CommunityTab; label: string }> = [
        { id: 'latest', label: 'Akis' },
        { id: 'members', label: 'Uyeler' },
        { id: 'rules', label: 'Kurallar' },
    ];

    if (selectedCommunity.permissions?.canManage) {
        tabs.push({ id: 'manage', label: 'Yonet' });
    }

    return (
        <div className="mx-auto min-h-screen max-w-[960px] px-3 py-4 md:px-0 md:py-3">
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

            <CommunityHeader
                community={selectedCommunity}
                joinLoading={joinLoading}
                onJoinToggle={handleJoinToggle}
                onInviteReject={handleInviteReject}
            />

            <div className="sticky top-[calc(var(--mobile-header-offset)+env(safe-area-inset-top)+112px)] z-10 mt-1 border-b border-border-subtle bg-bg-primary/96 px-2 backdrop-blur md:top-[72px] md:px-0">
                <div className="no-scrollbar flex items-center gap-5 overflow-x-auto px-1 md:inline-flex md:min-w-full md:gap-0 md:px-0">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                                setActiveTab(tab.id);
                                if (tab.id === 'latest') {
                                    setFeedMode(tab.id);
                                }
                            }}
                            className={`flex-none whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition md:flex-1 md:px-4 ${activeTab === tab.id
                                ? 'border-text-primary text-text-primary'
                                : 'border-transparent text-text-secondary'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {canPost && activeTab === 'latest' && (
                <div className="mt-4">
                    <QuickComposer
                        compact
                        communitySlug={selectedCommunity.slug}
                        onPosted={(post) => {
                            if (!user) return;
                            const createdAt = new Date().toISOString();
                            prependPost({
                                id: post.id,
                                content: post.content,
                                mediaUrl: post.mediaUrl,
                                mediaMimeType: post.mediaMimeType,
                                createdAt,
                                favCount: 0,
                                trashCount: 0,
                                replyCount: 0,
                                rtCount: 0,
                                authorUsername: user.username,
                                authorProfilePic: user.profilePic ?? null,
                                authorRole: user.role,
                                communityId: selectedCommunity.id,
                                communitySlug: selectedCommunity.slug,
                                communityName: selectedCommunity.name,
                                hasFav: false,
                                hasTrash: false,
                                type: 'post',
                            });
                        }}
                    />
                </div>
            )}

            <div className="mt-4 pb-[calc(var(--mobile-tabbar-offset)+env(safe-area-inset-bottom))] md:pb-0">
                {activeTab === 'latest' && (
                    <CommunityFeedTab
                        posts={displayPosts}
                        emptyLabel={displayLoading ? 'Akis yukleniyor...' : 'Henuz post yok.'}
                        onInteract={handleInteract}
                        onRepost={handleRepost}
                        onShare={handleShare}
                    />
                )}
                {activeNextCursor && (
                    <div ref={loadMoreSentinelRef} className="flex justify-center py-6">
                        {isLoadingMore && <Loader2 className="h-5 w-5 animate-spin text-text-muted" />}
                    </div>
                )}
                {activeTab === 'members' && (
                    <CommunityMembersTab
                        canModerate={Boolean(selectedCommunity.permissions?.canModerate)}
                        canManage={Boolean(selectedCommunity.permissions?.canManage)}
                        members={members}
                        invites={invites}
                        pendingRequests={pendingRequests}
                        inviteUsername={inviteUsername}
                        inviteLoading={inviteLoading}
                        requestActionUserId={requestActionUserId}
                        roleActionUserId={roleActionUserId}
                        onInviteUsernameChange={setInviteUsername}
                        onInvite={handleInvite}
                        onRequestAction={handleRequestApproval}
                        onRoleChange={handleRoleChange}
                    />
                )}
                {activeTab === 'rules' && (
                    <CommunityRulesTab
                        rules={rules}
                        canModerate={Boolean(selectedCommunity.permissions?.canModerate)}
                        saving={ruleSaving}
                        deletingRuleId={deletingRuleId}
                        onCreateRule={handleCreateRule}
                        onUpdateRule={handleUpdateRule}
                        onDeleteRule={handleDeleteRule}
                    />
                )}
                {activeTab === 'manage' && selectedCommunity.permissions?.canManage && (
                    <CommunityManageTab
                        form={manageForm}
                        saving={manageSaving}
                        deleting={manageDeleting}
                        avatarPreviewUrl={manageAvatarPreviewUrl}
                        avatarInputRef={avatarInputRef}
                        community={selectedCommunity}
                        onChange={(next) => setManageForm((current) => ({ ...current, ...next }))}
                        onAvatarSelect={handleManageAvatarSelect}
                        onAvatarRemove={handleManageAvatarRemove}
                        onSave={handleManageSave}
                        onDelete={handleDeleteCommunity}
                    />
                )}
            </div>
        </div>
    );
}
