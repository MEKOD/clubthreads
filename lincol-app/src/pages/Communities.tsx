import { Navigate, useSearchParams } from 'react-router-dom';
import { CommunityHubPage } from './CommunityHubPage';
import { useCommunityStore } from '../store/communityStore';

export function Communities() {
    const [searchParams] = useSearchParams();
    const lastVisitedCommunitySlug = useCommunityStore((state) => state.lastVisitedCommunitySlug);

    if (!searchParams.has('hub') && lastVisitedCommunitySlug) {
        return <Navigate to={`/communities/${lastVisitedCommunitySlug}`} replace />;
    }

    return <CommunityHubPage />;
}
