import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAgentNames } from '@/hooks/useAgentNames';
import { isFullActorId, resolveAgentRouteId } from '@/lib/basket-utils';
import { fetchAgentAddressByPublicId } from '@/lib/contestLeaderboard';

export function useAgentRouteAddress(routeId: string | undefined) {
  const { agents } = useAgentNames();
  const decodedRouteId = useMemo(
    () => decodeURIComponent(routeId ?? '').trim(),
    [routeId],
  );

  const legacyAddress = useMemo(() => {
    if (!decodedRouteId) {
      return '';
    }

    if (isFullActorId(decodedRouteId)) {
      return decodedRouteId.toLowerCase();
    }

    return resolveAgentRouteId(decodedRouteId, agents);
  }, [agents, decodedRouteId]);

  const publicIdentityQuery = useQuery({
    queryKey: ['agent-route-public-id', decodedRouteId],
    enabled: decodedRouteId.length > 0 && legacyAddress.length === 0,
    queryFn: () => fetchAgentAddressByPublicId(decodedRouteId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const resolvedAddress = legacyAddress || publicIdentityQuery.data?.user.toLowerCase() || '';
  const resolvedPublicId = publicIdentityQuery.data?.publicId ?? (
    legacyAddress.length === 0 ? decodedRouteId : null
  );

  return {
    address: resolvedAddress,
    publicId: resolvedPublicId,
    isLoading: decodedRouteId.length > 0 && legacyAddress.length === 0 && publicIdentityQuery.isLoading,
    isError: decodedRouteId.length > 0 && legacyAddress.length === 0 && publicIdentityQuery.isError,
    error: publicIdentityQuery.error,
  };
}
