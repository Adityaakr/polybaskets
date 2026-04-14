import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, useApi } from '@gear-js/react-hooks';
import type { Signer } from '@polkadot/api/types';
import { AlertCircle, Coins, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useWallet } from '@/contexts/WalletContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useToast } from '@/hooks/use-toast';
import { AgentTradingNotice } from '@/components/AgentTradingNotice';
import { isManualBettingEnabled } from '@/env';
import { actorIdFromAddress } from '@/lib/varaClient';
import { requestBetQuote } from '@/lib/betQuoteService';
import {
  betLaneProgramFromApi,
  betTokenProgramFromApi,
  fromTokenUnits,
  isBetProgramsConfigured,
  readSailsQuery,
  signAndSendBatch,
  toBigIntValue,
  toTokenUnits,
  waitForQueryMatch,
} from '@/lib/betPrograms.ts';

type BetLanePanelProps = {
  basketId: number | null;
  basketStatus: 'Active' | 'SettlementPending' | 'Settled' | null | undefined;
  settlement: Settlement | null;
};

type BettingPhase = 'idle' | 'approving' | 'betting';

const BET_QUERY_KEYS = {
  tokenMeta: ['bet-token-meta'],
  claimConfig: ['bet-token-claim-config'],
  laneConfig: ['bet-lane-config'],
};

export function BetLanePanel({
  basketId,
  basketStatus,
  settlement,
}: BetLanePanelProps) {
  const { api, isApiReady } = useApi();
  const { account } = useAccount();
  const { address, connect } = useWallet();
  const { network } = useNetwork();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const manualBettingEnabled = isManualBettingEnabled();
  const [betAmount, setBetAmount] = useState('');
  const [bettingPhase, setBettingPhase] = useState<BettingPhase>('idle');
  const [claimingPayout, setClaimingPayout] = useState(false);

  const isVaraEth = network === 'varaeth';
  const isConfigured = isBetProgramsConfigured();
  const signer = useMemo(() => {
    if (!account) {
      return null;
    }

    return (account as unknown as { signer?: Signer }).signer ?? null;
  }, [account]);
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
    } catch (error) {
      console.error('[BetLanePanel] Failed to create bet token program:', error);
      return null;
    }
  }, [api, isApiReady, isConfigured, isVaraEth]);

  const betLaneProgram = useMemo(() => {
    if (!api || !isApiReady || isVaraEth || !isConfigured) {
      return null;
    }

    try {
      return betLaneProgramFromApi(api);
    } catch (error) {
      console.error('[BetLanePanel] Failed to create bet lane program:', error);
      return null;
    }
  }, [api, isApiReady, isConfigured, isVaraEth]);

  const tokenMetaQuery = useQuery({
    queryKey: [...BET_QUERY_KEYS.tokenMeta, betTokenProgram?.programId],
    enabled: !!betTokenProgram,
    queryFn: async () => {
      const [name, symbol, decimals] = await Promise.all([
        readSailsQuery(betTokenProgram!.betToken.name()),
        readSailsQuery(betTokenProgram!.betToken.symbol()),
        readSailsQuery(betTokenProgram!.betToken.decimals()),
      ]);

      return {
        name,
        symbol,
        decimals: Number(decimals),
      };
    },
    staleTime: 60_000,
  });

  const tokenName = tokenMetaQuery.data?.name || 'Chip';
  const tokenSymbol = tokenMetaQuery.data?.symbol || 'CHIP';
  const tokenDecimals = tokenMetaQuery.data?.decimals ?? 12;

  const laneConfigQuery = useQuery({
    queryKey: [...BET_QUERY_KEYS.laneConfig, betLaneProgram?.programId],
    enabled: !!betLaneProgram,
    queryFn: async () => readSailsQuery(betLaneProgram!.betLane.getConfig()),
    staleTime: 60_000,
  });

  const balanceQuery = useQuery({
    queryKey: ['bet-token-balance', walletActorId, betTokenProgram?.programId],
    enabled: !!betTokenProgram && !!walletActorId,
    queryFn: async () =>
      readSailsQuery(betTokenProgram!.betToken.balanceOf(walletActorId!)),
    refetchInterval: 10_000,
  });

  const allowanceQuery = useQuery({
    queryKey: [
      'bet-token-allowance',
      walletActorId,
      betTokenProgram?.programId,
      betLaneProgram?.programId,
    ],
    enabled: !!betTokenProgram && !!betLaneProgram && !!walletActorId,
    queryFn: async () =>
      readSailsQuery(
        betTokenProgram!.betToken.allowance(walletActorId!, betLaneProgram!.programId),
      ),
    refetchInterval: 10_000,
  });

  const positionQuery = useQuery({
    queryKey: ['bet-lane-position', walletActorId, basketId, betLaneProgram?.programId],
    enabled: !!betLaneProgram && !!walletActorId && basketId !== null,
    queryFn: async () =>
      readSailsQuery(betLaneProgram!.betLane.getPosition(walletActorId!, basketId!)),
    refetchInterval: 10_000,
  });

  const balanceUnits = toBigIntValue(balanceQuery.data);
  const allowanceUnits = toBigIntValue(allowanceQuery.data);
  const lanePosition = positionQuery.data;
  const laneShares = toBigIntValue(lanePosition?.shares);
  const hasLanePosition = laneShares > 0n;
  const laneClaimed = Boolean(lanePosition?.claimed);

  const parsedBetUnits = useMemo(() => {
    if (!betAmount.trim()) {
      return null;
    }

    try {
      return toTokenUnits(betAmount, tokenDecimals);
    } catch {
      return null;
    }
  }, [betAmount, tokenDecimals]);

  const settlementStatus = useMemo(() => {
    if (!settlement?.status) {
      return null;
    }

    return typeof settlement.status === 'object' && settlement.status !== null
      ? Object.keys(settlement.status)[0]
      : settlement.status;
  }, [settlement?.status]);

  const expectedPayoutUnits = useMemo(() => {
    if (!settlement || !hasLanePosition || !lanePosition || lanePosition.index_at_creation_bps <= 0) {
      return null;
    }

    const payoutPerShare = toBigIntValue(settlement.payout_per_share);
    if (payoutPerShare === 0n) {
      return 0n;
    }

    return (laneShares * payoutPerShare) / BigInt(lanePosition.index_at_creation_bps);
  }, [hasLanePosition, lanePosition, laneShares, settlement]);

  const expectedPayoutDisplay =
    expectedPayoutUnits === null
      ? null
      : fromTokenUnits(expectedPayoutUnits, tokenDecimals);

  const canClaimPayout =
    basketId !== null &&
    settlementStatus === 'Finalized' &&
    hasLanePosition &&
    !laneClaimed;

  const allowanceEnough =
    parsedBetUnits !== null && parsedBetUnits > 0n && allowanceUnits >= parsedBetUnits;

  const minBetUnits = toBigIntValue(laneConfigQuery.data?.min_bet);
  const maxBetUnits = toBigIntValue(laneConfigQuery.data?.max_bet);
  const decimalsBase = 10n ** BigInt(tokenDecimals);
  const likelyUnscaledConfig =
    tokenDecimals > 0 &&
    laneConfigQuery.data && maxBetUnits > 0n && maxBetUnits < decimalsBase;

  const isBetting = bettingPhase !== 'idle';
  const isReadyForWrites =
    !!betTokenProgram && !!betLaneProgram && !!account && !!signer && !!walletActorId;

  const invalidateBetQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: BET_QUERY_KEYS.tokenMeta }),
      queryClient.invalidateQueries({ queryKey: BET_QUERY_KEYS.laneConfig }),
      queryClient.invalidateQueries({ queryKey: ['bet-token-balance'] }),
      queryClient.invalidateQueries({ queryKey: ['bet-token-allowance'] }),
      queryClient.invalidateQueries({ queryKey: ['bet-lane-position'] }),
    ]);
  };

  const requireWallet = async () => {
    if (!address) {
      await connect();
      return false;
    }

    if (!isReadyForWrites) {
      toast({
        title: 'Wallet Not Ready',
        description: `Connect a Vara wallet and wait for account readiness before using ${tokenSymbol}.`,
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  const handlePlaceBet = async () => {
    if (!manualBettingEnabled) {
      toast({
        title: 'Agent-Only Execution',
        description: `${tokenSymbol} betting is available through your agent only.`,
        variant: 'destructive',
      });
      return;
    }

    if (!(await requireWallet()) || !betTokenProgram || !betLaneProgram || basketId === null) {
      return;
    }

    if (basketStatus !== 'Active') {
      toast({
        title: 'Basket Not Active',
        description: `${tokenSymbol} bets are only available while the basket is active.`,
        variant: 'destructive',
      });
      return;
    }

    if (!parsedBetUnits || parsedBetUnits <= 0n) {
      toast({
        title: 'Invalid Amount',
        description: `Enter a valid ${tokenSymbol} amount.`,
        variant: 'destructive',
      });
      return;
    }

    if (parsedBetUnits > balanceUnits) {
      toast({
        title: `Insufficient ${tokenSymbol}`,
        description: `Your ${tokenSymbol} balance is too low for this bet.`,
        variant: 'destructive',
      });
      return;
    }

    if (laneConfigQuery.data) {
      if (parsedBetUnits < minBetUnits) {
        toast({
          title: 'Bet Too Small',
          description: `Minimum ${tokenSymbol} size is ${fromTokenUnits(minBetUnits, tokenDecimals)} ${tokenSymbol}.`,
          variant: 'destructive',
        });
        return;
      }

      if (parsedBetUnits > maxBetUnits) {
        toast({
          title: 'Bet Too Large',
          description: `Maximum ${tokenSymbol} size is ${fromTokenUnits(maxBetUnits, tokenDecimals)} ${tokenSymbol}.`,
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      const signedQuote = await requestBetQuote({
        targetProgramId: betLaneProgram.programId,
        user: walletActorId!,
        basketId,
        amount: parsedBetUnits.toString(),
      });

      if (!allowanceEnough) {
        setBettingPhase('approving');

        const approveTx = betTokenProgram.betToken
          .approve(betLaneProgram.programId, parsedBetUnits)
          .withAccount(account!.address, { signer: signer! });

        await approveTx.calculateGas();
        const betTx = betLaneProgram.betLane
          .placeBet(basketId, parsedBetUnits, signedQuote)
          .withAccount(account!.address, { signer: signer! })
          .withGas('max');

        setBettingPhase('betting');
        await signAndSendBatch({
          api,
          account: account!.address,
          signer: signer!,
          extrinsics: [approveTx.extrinsic, betTx.extrinsic],
        });
      } else {
        setBettingPhase('betting');

        const betTx = betLaneProgram.betLane
          .placeBet(basketId, parsedBetUnits, signedQuote)
          .withAccount(account!.address, { signer: signer! });

        await betTx.calculateGas();
        const { response } = await betTx.signAndSend();
        await response();
      }

      await waitForQueryMatch(
        async () =>
          readSailsQuery(betLaneProgram.betLane.getPosition(walletActorId!, basketId)),
        (position) => toBigIntValue(position?.shares) >= parsedBetUnits,
        {
          attempts: 10,
          delayMs: 1_200,
          label: `${tokenSymbol} position for basket ${basketId}`,
        },
      );

      toast({
        title: `${tokenSymbol} Bet Placed`,
        description: `${betAmount} ${tokenSymbol} entered at ${(signedQuote.payload.quoted_index_bps / 100).toFixed(2)}%.`,
      });

      setBetAmount('');
      await invalidateBetQueries();
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to place ${tokenSymbol} bet`;
      toast({
        title: `${tokenSymbol} Bet Failed`,
        description: message,
        variant: 'destructive',
      });
    } finally {
      setBettingPhase('idle');
    }
  };

  const handleClaimPayout = async () => {
    if (!(await requireWallet()) || !betLaneProgram || basketId === null) {
      return;
    }

    if (!canClaimPayout) {
      toast({
        title: 'Claim Not Available',
        description: `${tokenSymbol} payout can be claimed after final settlement only.`,
        variant: 'destructive',
      });
      return;
    }

    setClaimingPayout(true);

    try {
      const tx = betLaneProgram.betLane
        .claim(basketId)
        .withAccount(account!.address, { signer: signer! });

      await tx.calculateGas();
      const { response } = await tx.signAndSend();
      const claimedAmount = toBigIntValue(await response());
      const claimedDisplay = fromTokenUnits(claimedAmount, tokenDecimals);

      toast({
        title: `${tokenSymbol} Payout Claimed`,
        description:
          claimedAmount > 0n
            ? `${claimedDisplay} ${tokenSymbol} sent to your wallet.`
            : `Position finalized with a 0 ${tokenSymbol} payout.`,
      });

      await invalidateBetQueries();
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to claim ${tokenSymbol} payout`;
      toast({
        title: `${tokenSymbol} Claim Failed`,
        description: message,
        variant: 'destructive',
      });
    } finally {
      setClaimingPayout(false);
    }
  };

  let actionLabel = 'Place Bet';
  if (!address) {
    actionLabel = 'Connect Wallet';
  } else if (bettingPhase === 'approving') {
    actionLabel = `Approving ${tokenSymbol}...`;
  } else if (bettingPhase === 'betting') {
    actionLabel = `Placing ${tokenSymbol}...`;
  } else if (parsedBetUnits && parsedBetUnits > 0n && !allowanceEnough) {
    actionLabel = `Approve & Bet ${tokenSymbol}`;
  }

  const actionDisabled =
    !manualBettingEnabled ||
    isVaraEth ||
    !isConfigured ||
    !betTokenProgram ||
    !betLaneProgram ||
    bettingPhase !== 'idle' ||
    basketId === null ||
    basketStatus !== 'Active' ||
    !betAmount.trim() ||
    !parsedBetUnits ||
    parsedBetUnits <= 0n;

  const claimDescription = canClaimPayout
    ? expectedPayoutUnits === 0n
      ? `Settlement is finalized. Finalize your position (${fromTokenUnits(laneShares, tokenDecimals)} ${tokenSymbol} stake returned as 0 payout).`
      : `Settlement is finalized. Claim ${expectedPayoutDisplay ?? '0'} ${tokenSymbol}.`
    : !hasLanePosition
      ? address
        ? `You do not have a ${tokenSymbol} position in this basket yet.`
        : `Connect your wallet to check if you have a ${tokenSymbol} position in this basket.`
      : !settlement
        ? `No settlement has been proposed on-chain yet. ${tokenSymbol} payout unlocks only after the main basket settlement is proposed and finalized.`
      : settlementStatus !== 'Finalized'
        ? `Settlement status: ${settlementStatus || 'Unknown'}. Settlement must be finalized before claiming.`
        : laneClaimed
          ? `You have already finalized this ${tokenSymbol} position.`
          : `No ${tokenSymbol} payout is available yet.`;

  return (
    <>
      {basketStatus === 'Active' && (
        manualBettingEnabled ? (
        <Card className="card-elevated border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="w-4 h-4 text-amber-500" />
              Bet on Basket
            </CardTitle>
            {hasLanePosition && (
              <CardDescription>
                Your shares: {fromTokenUnits(laneShares, tokenDecimals)} {tokenSymbol}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {isVaraEth && (
              <Alert>
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  {tokenSymbol} lane is wired for the Vara Network flow. Switch off Vara.eth to use it.
                </AlertDescription>
              </Alert>
            )}

            {!isVaraEth && !isConfigured && (
              <Alert>
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  Set <code>VITE_BET_TOKEN_PROGRAM_ID</code> and <code>VITE_BET_LANE_PROGRAM_ID</code> to enable {tokenName}.
                </AlertDescription>
              </Alert>
            )}

            {!isVaraEth && isConfigured && likelyUnscaledConfig && (
              <Alert>
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  Current {tokenSymbol} config looks unscaled for token decimals. If claims or max bet look tiny, update on-chain config before launch.
                </AlertDescription>
              </Alert>
            )}

            {!isVaraEth && isConfigured && (
              <div className="space-y-3">
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={`Enter ${tokenSymbol} amount`}
                  value={betAmount}
                  onChange={(event) => setBetAmount(event.target.value)}
                  min="0"
                  max={fromTokenUnits(balanceUnits, tokenDecimals, tokenDecimals)}
                  step="0.0001"
                />

                <Button
                  onClick={address ? handlePlaceBet : connect}
                  disabled={actionDisabled}
                  className="w-full gap-2"
                  size="lg"
                >
                  {isBetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
                  {address ? actionLabel : 'Connect Wallet'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        ) : (
          <AgentTradingNotice description={`${tokenSymbol} betting is available through your agent only.`} />
        )
      )}

      <Card className={`card-elevated ${manualBettingEnabled && canClaimPayout ? 'border-accent' : 'border-border/60'}`}>
        <CardHeader>
          <CardTitle className="text-base">Claim Payout</CardTitle>
          <CardDescription>
            {manualBettingEnabled
              ? claimDescription
              : `${tokenSymbol} payout claiming is available through your agent only.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {hasLanePosition && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Shares</span>
                <span className="font-medium">
                  {fromTokenUnits(laneShares, tokenDecimals)} {tokenSymbol}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Entry index</span>
                <span className="font-medium">
                  {(Number(lanePosition?.index_at_creation_bps || 0) / 100).toFixed(2)}%
                </span>
              </div>
              {expectedPayoutDisplay !== null && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Expected payout</span>
                  <span className="font-medium">
                    {expectedPayoutDisplay} {tokenSymbol}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={laneClaimed ? 'default' : 'secondary'}>
                  {laneClaimed ? 'Claimed' : 'Open'}
                </Badge>
              </div>
            </div>
          )}

          {manualBettingEnabled && canClaimPayout ? (
            <Button
              onClick={handleClaimPayout}
              disabled={claimingPayout}
              className="w-full gap-2"
              variant={expectedPayoutUnits && expectedPayoutUnits > 0n ? 'default' : 'secondary'}
            >
              {claimingPayout ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Claiming {tokenSymbol}...
                </>
              ) : (
                <>
                  <Coins className="w-4 h-4" />
                  {expectedPayoutUnits === 0n
                    ? 'Finalize Position'
                    : `Claim ${expectedPayoutDisplay ?? '0'} ${tokenSymbol}`}
                </>
              )}
            </Button>
          ) : !manualBettingEnabled ? (
            <AgentTradingNotice description={`${tokenSymbol} payout claiming is available through your agent only.`} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {hasLanePosition
                ? !settlement
                  ? 'Waiting for the main basket settlement to be proposed on-chain.'
                  : settlementStatus !== 'Finalized'
                  ? 'Payout unlocks after settlement is finalized.'
                  : laneClaimed
                    ? `This ${tokenSymbol} position is already finalized.`
                    : 'Claim is not available yet.'
                : `Place a ${tokenSymbol} stake first to open a claimable position.`}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
