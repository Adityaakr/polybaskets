import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, useApi } from '@gear-js/react-hooks';
import { Sparkles, Coins, CalendarClock, ShieldCheck } from 'lucide-react';
import { actorIdFromAddress } from '@/lib/varaClient.ts';
import { useWallet } from '@/contexts/WalletContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { betTokenProgramFromApi, fromTokenUnits, isBetProgramsConfigured, readSailsQuery, toBigIntValue } from '@/lib/betPrograms.ts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { WalletButton } from '@/components/WalletButton';

export default function ClaimPage() {
  const { api, isApiReady } = useApi();
  const { account } = useAccount();
  const { address, connect } = useWallet();
  const { network } = useNetwork();
  const { toast } = useToast();
  const [claiming, setClaiming] = useState(false);

  const isVaraEth = network === 'varaeth';
  const isConfigured = isBetProgramsConfigured();
  const walletActorId = useMemo(
    () => (address && !isVaraEth ? actorIdFromAddress(address) : null),
    [address, isVaraEth],
  );

  const betTokenProgram = useMemo(() => {
    if (!api || !isApiReady || isVaraEth || !isConfigured) {
      return null;
    }

    try {
      return betTokenProgramFromApi(api);
    } catch {
      return null;
    }
  }, [api, isApiReady, isConfigured, isVaraEth]);

  const metaQuery = useQuery({
    queryKey: ['claim-page-token-meta', betTokenProgram?.programId],
    enabled: !!betTokenProgram,
    queryFn: async () => {
      const [name, symbol, decimals] = await Promise.all([
        readSailsQuery(betTokenProgram!.betToken.name()),
        readSailsQuery(betTokenProgram!.betToken.symbol()),
        readSailsQuery(betTokenProgram!.betToken.decimals()),
      ]);

      return { name, symbol, decimals: Number(decimals) };
    },
    staleTime: 60_000,
  });

  const tokenName = metaQuery.data?.name || 'Chip';
  const tokenSymbol = metaQuery.data?.symbol || 'CHIP';
  const tokenDecimals = metaQuery.data?.decimals ?? 12;

  const balanceQuery = useQuery({
    queryKey: ['claim-page-balance', walletActorId, betTokenProgram?.programId],
    enabled: !!betTokenProgram && !!walletActorId,
    queryFn: async () => readSailsQuery(betTokenProgram!.betToken.balanceOf(walletActorId!)),
    refetchInterval: 10_000,
  });

  const claimPreviewQuery = useQuery({
    queryKey: ['claim-page-preview', walletActorId, betTokenProgram?.programId],
    enabled: !!betTokenProgram && !!walletActorId,
    queryFn: async () => readSailsQuery(betTokenProgram!.betToken.getClaimPreview(walletActorId!)),
    refetchInterval: 10_000,
  });

  const claimStateQuery = useQuery({
    queryKey: ['claim-page-state', walletActorId, betTokenProgram?.programId],
    enabled: !!betTokenProgram && !!walletActorId,
    queryFn: async () => readSailsQuery(betTokenProgram!.betToken.getClaimState(walletActorId!)),
    refetchInterval: 10_000,
  });

  const configQuery = useQuery({
    queryKey: ['claim-page-config', betTokenProgram?.programId],
    enabled: !!betTokenProgram,
    queryFn: async () => readSailsQuery(betTokenProgram!.betToken.getClaimConfig()),
    staleTime: 60_000,
  });

  const claimPreview = claimPreviewQuery.data;
  const claimState = claimStateQuery.data;
  const balanceUnits = toBigIntValue(balanceQuery.data);
  const canClaimNow = Boolean(claimPreview?.can_claim_now);
  const nextClaimAtLabel =
    claimPreview?.next_claim_at != null
      ? new Date(Number(claimPreview.next_claim_at)).toLocaleString()
      : null;

  const handleClaim = async () => {
    if (!address) {
      await connect();
      return;
    }

    if (!betTokenProgram || !account || !canClaimNow) {
      return;
    }

    setClaiming(true);
    try {
      const tx = betTokenProgram.betToken
        .claim()
        .withAccount(account.address, { signer: (account as unknown as { signer: unknown }).signer as never });

      await tx.calculateGas();
      const { response } = await tx.signAndSend();
      await response();
      await Promise.all([
        balanceQuery.refetch(),
        claimPreviewQuery.refetch(),
        claimStateQuery.refetch(),
      ]);

      toast({
        title: `${tokenSymbol} Claimed`,
        description: `Daily ${tokenName} was credited to your wallet.`,
      });
    } catch (error) {
      toast({
        title: `${tokenSymbol} Claim Failed`,
        description: error instanceof Error ? error.message : `Failed to claim ${tokenSymbol}`,
        variant: 'destructive',
      });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="content-grid py-8">
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-5xl font-display font-bold mb-3 tracking-tight gradient-text">Claim</h1>
          <p className="text-muted-foreground text-base">
            Daily {tokenSymbol} balance, streak and claim rules live here.
          </p>
        </div>

        {isVaraEth && (
          <Alert>
            <AlertDescription>
              {tokenSymbol} claim is available only on Vara Network.
            </AlertDescription>
          </Alert>
        )}

        {!isVaraEth && !isConfigured && (
          <Alert>
            <AlertDescription>
              Set {tokenSymbol} token and lane program IDs to enable the claim flow.
            </AlertDescription>
          </Alert>
        )}

        {!isVaraEth && isConfigured && (
          <>
            <div className="grid md:grid-cols-3 gap-4">
              <Card className="card-elevated">
                <CardHeader className="pb-2">
                  <CardDescription>Balance</CardDescription>
                  <CardTitle className="text-2xl">{fromTokenUnits(balanceUnits, tokenDecimals)} {tokenSymbol}</CardTitle>
                </CardHeader>
              </Card>
              <Card className="card-elevated">
                <CardHeader className="pb-2">
                  <CardDescription>Current Streak</CardDescription>
                  <CardTitle className="text-2xl">{claimState?.streak_days ?? 0}d</CardTitle>
                </CardHeader>
              </Card>
              <Card className="card-elevated">
                <CardHeader className="pb-2">
                  <CardDescription>Claim Status</CardDescription>
                  <CardTitle className="text-2xl">
                    <Badge variant={canClaimNow ? 'default' : 'secondary'}>
                      {canClaimNow ? 'Ready' : 'Cooldown'}
                    </Badge>
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  Daily Claim
                </CardTitle>
                <CardDescription>
                  Claim free {tokenSymbol} once per 24 hours. Missing a day stops new accrual, but your existing balance stays in the wallet.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Next claim amount</span>
                  <span className="font-medium">
                    {claimPreview ? fromTokenUnits(claimPreview.amount, tokenDecimals) : '0'} {tokenSymbol}
                  </span>
                </div>
                {!canClaimNow && nextClaimAtLabel && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarClock className="w-4 h-4" />
                    Next claim window opens at {nextClaimAtLabel}
                  </div>
                )}
                {!address ? (
                  <div className="flex justify-center">
                    <WalletButton />
                  </div>
                ) : (
                  <Button onClick={handleClaim} disabled={claiming || !canClaimNow} className="w-full gap-2">
                    {claiming ? (
                      <>Claiming...</>
                    ) : (
                      <>
                        <Coins className="w-4 h-4" />
                        {`Claim ${tokenSymbol}`}
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                  Rules
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Claim period: once every {configQuery.data ? Math.round(Number(configQuery.data.claim_period) / 3_600_000) : 24} hours.</p>
                <p>Base reward: {configQuery.data ? fromTokenUnits(configQuery.data.base_claim_amount, tokenDecimals) : '0'} {tokenSymbol}.</p>
                <p>Max reward: {configQuery.data ? fromTokenUnits(configQuery.data.max_claim_amount, tokenDecimals) : '0'} {tokenSymbol}.</p>
                <p>Streak step: {configQuery.data ? fromTokenUnits(configQuery.data.streak_step, tokenDecimals) : '0'} {tokenSymbol} per day until cap.</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
