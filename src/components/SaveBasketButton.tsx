import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useBasket } from '@/contexts/BasketContext';
import { useWallet } from '@/contexts/WalletContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useApi, useAccount } from '@gear-js/react-hooks';
import { getBaskets } from '@/lib/basket-storage.ts';
import { Basket } from '@/types/basket.ts';
import type { BasketAssetKind } from '@/types/basket.ts';
import { createSnapshot, validateBasket } from '@/lib/basket-utils.ts';
import { OutcomeProbabilities } from '@/types/polymarket.ts';
import { basketMarketProgramFromApi, toVara } from '@/lib/varaClient.ts';
import { calculateBetAllocationFromVara, formatVara, formatUsd, VARA_PRICE_USD } from '@/lib/betCalculator.ts';
import {
  betLaneProgramFromApi,
  betTokenProgramFromApi,
  fromTokenUnits,
  isBetProgramsConfigured,
  isRateLimitError,
  readSailsQuery,
  signAndSendBatch,
  toBigIntValue,
  toTokenUnits,
  waitForQueryMatch,
  withRateLimitRetry,
} from '@/lib/betPrograms.ts';
import { ENV, getDefaultBasketAssetKind, isManualBettingEnabled, isVaraEnabled } from '@/env';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Circle, CheckCircle2, Clock } from 'lucide-react';
import { useVaraEthBasketMarket } from '@/hooks/useVaraEthBasketMarket';
import { toWVara } from '@/lib/varaEthClient.ts';
import { Badge } from '@/components/ui/badge';
import { actorIdFromAddress } from '@/lib/varaClient';
import { normalizeAssetKind, toContractAssetKind } from '@/lib/assetKind';
import { requestBetQuote } from '@/lib/betQuoteService';

interface SaveBasketButtonProps {
  marketProbabilities: Map<string, OutcomeProbabilities>;
  marketPrices?: Map<string, { YES: number; NO: number }>;
}

type TxStatus = 'idle' | 'submitted' | 'accepted' | 'finalized';

export function SaveBasketButton({ marketProbabilities, marketPrices }: SaveBasketButtonProps) {
  const navigate = useNavigate();
  const { items, name, description, tags, clearBasket } = useBasket();
  const { address, connect } = useWallet();
  const { network, config } = useNetwork();
  const { api, isApiReady } = useApi();
  const { account } = useAccount();
  const { toast } = useToast();
  const { basketMarket: varaEthBasketMarket, isLoading: isLoadingVaraEth } = useVaraEthBasketMarket();
  const varaEnabled = isVaraEnabled();
  const manualBettingEnabled = isManualBettingEnabled();
  const didAutofillDefaultBetRef = useRef(false);
  
  const [status, setStatus] = useState<TxStatus>('idle');
  const [betAmount, setBetAmount] = useState('');
  const [assetKind, setAssetKind] = useState<BasketAssetKind>(getDefaultBasketAssetKind());
  
  const isVaraEth = network === 'varaeth';
  const betProgramsConfigured = isBetProgramsConfigured();
  const walletActorId = useMemo(
    () => (address && !isVaraEth ? actorIdFromAddress(address) : null),
    [address, isVaraEth],
  );
  const betTokenProgram = useMemo(() => {
    if (!api || !isApiReady || isVaraEth || !betProgramsConfigured) {
      return null;
    }

    try {
      return betTokenProgramFromApi(api);
    } catch {
      return null;
    }
  }, [api, isApiReady, isVaraEth, betProgramsConfigured]);

  const tokenMetaQuery = useQuery({
    queryKey: ['builder-bet-token-meta', betTokenProgram?.programId],
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

  const tokenSymbol = tokenMetaQuery.data?.symbol || 'CHIP';
  const tokenDecimals = tokenMetaQuery.data?.decimals ?? 12;

  const errors = validateBasket(items, name);
  const isValid = errors.length === 0;
  
  // Auto-fill a fixed default amount when basket items appear
  useEffect(() => {
    if (items.length === 0) {
      didAutofillDefaultBetRef.current = false;
      return;
    }

    if (!didAutofillDefaultBetRef.current && !betAmount) {
      setBetAmount('10');
      didAutofillDefaultBetRef.current = true;
    }
  }, [items.length, betAmount]);

  useEffect(() => {
    if (!varaEnabled && assetKind !== 'FT') {
      setAssetKind('FT');
    }
  }, [assetKind, varaEnabled]);
  
  // Calculate allocation from VARA bet amount (based on basket weights)
  const betCalculation = useMemo(() => {
    if (!betAmount || items.length === 0) {
      return null;
    }
    
    const varaAmount = parseFloat(betAmount);
    if (isNaN(varaAmount) || varaAmount <= 0) {
      return null;
    }
    
    try {
      return calculateBetAllocationFromVara(varaAmount, items, marketPrices);
    } catch (error) {
      console.error('Error calculating bet allocation:', error);
      return null;
    }
  }, [betAmount, items, marketPrices]);
  
  const betAmountNum = betAmount ? parseFloat(betAmount) : 0;
  const parsedBetUnits = useMemo(() => {
    if (!betAmount.trim()) {
      return 0n;
    }

    try {
      return toTokenUnits(betAmount, tokenDecimals);
    } catch {
      return 0n;
    }
  }, [betAmount, tokenDecimals]);

  const betBalanceQuery = useQuery({
    queryKey: ['builder-bet-balance', walletActorId, betTokenProgram?.programId],
    enabled: assetKind === 'FT' && !!betTokenProgram && !!walletActorId,
    queryFn: async () => readSailsQuery(betTokenProgram!.betToken.balanceOf(walletActorId!)),
    refetchInterval: 10_000,
  });

  const betBalanceUnits = toBigIntValue(betBalanceQuery.data);
  const hasEnoughBetForInitialStake = parsedBetUnits > 0n && betBalanceUnits >= parsedBetUnits;
  const isMissingRequiredFtAmount =
    assetKind === 'FT' && (!betAmount.trim() || betAmountNum <= 0 || Number.isNaN(betAmountNum));
  const hasInsufficientFtBalance =
    assetKind === 'FT' && parsedBetUnits > 0n && parsedBetUnits > betBalanceUnits;
  
  // Validate bet amount if provided
  const isValidBetAmount = !betAmount || (betAmountNum > 0 && !isNaN(betAmountNum));
  const disabledReason =
    !manualBettingEnabled ? 'Manual basket creation is disabled in this deployment.' :
    !isValid ? errors[0] :
    isMissingRequiredFtAmount ? `${tokenSymbol} amount is required.` :
    !isValidBetAmount ? 'Enter a valid bet amount.' :
    hasInsufficientFtBalance ? `Not enough ${tokenSymbol}. Enter ${fromTokenUnits(betBalanceUnits, tokenDecimals)} ${tokenSymbol} or less.` :
    status !== 'idle' ? 'Wait for the current transaction to finish.' :
    null;
  const isSaveDisabled =
    !manualBettingEnabled ||
    !isValid ||
    isMissingRequiredFtAmount ||
    !isValidBetAmount ||
    hasInsufficientFtBalance ||
    status !== 'idle';

  const handleSave = async () => {
    if (!manualBettingEnabled) {
      toast({
        title: 'Agent-Only Execution',
        description: 'Manual basket creation is disabled in this deployment. Use your agent or automation workflow instead.',
        variant: 'destructive',
      });
      return;
    }

    if (!address) {
      await connect();
      return;
    }

    if (!isValid) {
      toast({
        title: 'Invalid Basket',
        description: errors[0],
        variant: 'destructive',
      });
      return;
    }

    if (!isValidBetAmount) {
      toast({
        title: 'Invalid Bet Amount',
        description: 'Please enter a valid bet amount (optional, but must be > 0 if provided)',
        variant: 'destructive',
      });
      return;
    }

    if (assetKind === 'FT') {
      if (!betAmount || betAmountNum <= 0) {
        toast({
          title: `${tokenSymbol} Amount Required`,
          description: `${tokenSymbol} baskets should be created with an initial ${tokenSymbol} stake.`,
          variant: 'destructive',
        });
        return;
      }

      if (!hasEnoughBetForInitialStake) {
        toast({
          title: `Insufficient ${tokenSymbol}`,
          description: `Claim or mint ${tokenSymbol} first. Basket creation was blocked before sending any transaction.`,
          variant: 'destructive',
        });
        return;
      }
    }

    if (!varaEnabled && assetKind === 'Vara') {
      toast({
        title: 'CHIP-Only Mode',
        description: 'Native VARA baskets are disabled in this deployment.',
        variant: 'destructive',
      });
      return;
    }

    // Network-specific validation
    if (isVaraEth) {
      if (!varaEthBasketMarket || isLoadingVaraEth) {
        toast({
          title: 'Wallet Not Ready',
          description: 'Please ensure your MetaMask wallet is connected and ready.',
          variant: 'destructive',
        });
        return;
      }

      if (assetKind === 'FT' && isVaraEth) {
        toast({
          title: `${tokenSymbol} Is Vara-Only`,
          description: `${tokenSymbol} baskets are currently available only on Vara Network, not Vara.eth.`,
          variant: 'destructive',
        });
        return;
      }

      if (!ENV.VARAETH_PROGRAM_ID) {
        toast({
          title: 'Configuration Error',
          description: 'VARAETH_PROGRAM_ID is not configured. Please set VITE_VARAETH_PROGRAM_ID in your .env file.',
          variant: 'destructive',
        });
        return;
      }
    } else {
      if (!api || !isApiReady || !account) {
        toast({
          title: 'Wallet Not Ready',
          description: 'Please ensure your wallet is connected and the API is ready.',
          variant: 'destructive',
        });
        return;
      }

      if (!ENV.PROGRAM_ID) {
        toast({
          title: 'Configuration Error',
          description: 'PROGRAM_ID is not configured. Please set VITE_PROGRAM_ID in your .env file.',
          variant: 'destructive',
        });
        return;
      }

      if (assetKind === 'FT' && !betProgramsConfigured) {
        toast({
          title: `${tokenSymbol} Contracts Not Configured`,
          description: `Set ${tokenSymbol} token and lane program IDs before creating ${tokenSymbol} baskets.`,
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      setStatus('submitted');
      
      // Convert frontend basket items to contract format
      const contractItems = items.map(item => ({
        poly_market_id: item.marketId,
        poly_slug: item.slug,
        weight_bps: item.weightBps,
        selected_outcome: item.outcome,
      }));

      console.log('Creating basket on-chain...', { name, description, items: contractItems, network });
      
      let basketId: number;
      
      if (isVaraEth) {
        // Vara.eth network - use EthereumClient
        if (!varaEthBasketMarket) {
          throw new Error('Vara.eth basket market client not available');
        }
        
        // Ensure we're on the correct network before sending transaction
        const { isOnHoodiNetwork, switchToHoodiNetwork } = await import('@/lib/evmWallet');
        const isCorrectNetwork = await isOnHoodiNetwork();
        if (!isCorrectNetwork) {
          console.log('[VaraEth] Switching to Hoodi testnet...');
          await switchToHoodiNetwork();
        }
        
        try {
          const basketIdBigInt = await varaEthBasketMarket.createBasket(name, description, contractItems);
          basketId = Number(basketIdBigInt);
          console.log('Basket created successfully on Vara.eth with ID:', basketId);
        } catch (error: any) {
          console.error('Failed to create basket on Vara.eth:', error);
          
          // Check if the error is about uninitialized program
          if (error.message?.includes('uninitialized') || error.message?.includes('constructor')) {
            console.log('[VaraEth] Program not initialized. Attempting to initialize...');
            
            try {
              // Try to initialize with default values
              // settler_role: zero address (can be changed later)
              // liveness_seconds: 720 (12 minutes)
              toast({
                title: 'Initializing Program',
                description: 'The program needs to be initialized first. This may take a moment...',
              });
              
              await varaEthBasketMarket.initialize(
                '0x2e20c7db6cc6c97fd10ec8e6191c6002cdbf3c41085047a6d779605fc702f427' as `0x${string}`,
                720n // 12 minutes (720 seconds)
              );
              
              toast({
                title: 'Program Initialized',
                description: 'Program initialized successfully. Retrying basket creation...',
              });
              
              // Retry creating the basket
              const basketIdBigInt = await varaEthBasketMarket.createBasket(name, description, contractItems);
              basketId = Number(basketIdBigInt);
              console.log('Basket created successfully on Vara.eth with ID:', basketId);
            } catch (initError: any) {
              console.error('Failed to initialize program:', initError);
              setStatus('idle');
              
              // Provide more specific error message
              const errorMsg = initError.message || 'Unknown error';
              throw new Error(
                `Failed to initialize program.\n\n` +
                `${errorMsg}\n\n` +
                `Possible solutions:\n` +
                `1. The program may need to be initialized during creation (not after)\n` +
                `2. Fund the program with wVARA: https://explorer.hoodi.network/address/${ENV.VARAETH_PROGRAM_ID}\n` +
                `3. Try initializing manually using: cd ethexe && npm run init\n` +
                `4. Check if program is already initialized by checking the explorer`
              );
            }
          } else {
            setStatus('idle');
            throw error; // Re-throw other errors
          }
        }
      } else {
        // Vara Network - use Gear API
        const program = basketMarketProgramFromApi(api);
        const tx = program.basketMarket
          .createBasket(name, description, contractItems, toContractAssetKind(assetKind))
          .withAccount(account.address, { signer: (account as any).signer });

        console.log('Calculating gas...');
        await withRateLimitRetry(() => tx.calculateGas(), {
          label: 'basket creation gas estimation',
        });
        
        console.log('Signing and sending transaction...');
        const { response } = await withRateLimitRetry(() => tx.signAndSend(), {
          label: 'basket creation transaction submission',
          baseDelayMs: 1_500,
        });
        
        toast({
          title: 'Transaction Submitted',
          description: 'Your basket is being created on-chain...',
        });

        console.log('Waiting for response...');
        const res = await withRateLimitRetry(() => response(), {
          label: 'basket creation transaction response',
        });
        console.log('Transaction response:', res);

        // Handle error response
        if (res && typeof res === 'object' && 'err' in res) {
          throw new Error(`On-chain error: ${res.err}`);
        }

        // Extract basket ID from response
        // Note: Basket ID 0 is valid (first basket)
        let extractedBasketId: number | null = null;
        
        // Handle different response formats
        if (res && typeof res === 'object') {
          // Try { ok: value } format (standard Result format)
          if ('ok' in res) {
            const okValue = (res as any).ok;
            if (okValue !== null && okValue !== undefined) {
              extractedBasketId = typeof okValue === 'number' ? okValue : Number(okValue);
            }
          } else if ('err' in res) {
            // Already handled above, but double-check
            throw new Error(`On-chain error: ${(res as any).err}`);
          }
        } else if (typeof res === 'number' || typeof res === 'string' || typeof res === 'bigint') {
          // Direct value response
          extractedBasketId = Number(res);
        }

        // Validate basket ID (0 is valid - it's the first basket)
        if (extractedBasketId === null || isNaN(extractedBasketId) || extractedBasketId < 0) {
          console.error('Failed to extract basket ID. Response structure:', JSON.stringify(res, null, 2));
          throw new Error(`Failed to get basket ID from transaction response. Response: ${JSON.stringify(res)}`);
        }
        
        basketId = extractedBasketId;
        console.log('Basket created successfully on Vara Network with ID:', basketId);

        if (assetKind === 'FT') {
          await waitForQueryMatch(
            async () => readSailsQuery(program.basketMarket.getBasket(basketId)),
            (result) =>
              typeof result === 'object' &&
              result !== null &&
              'ok' in result &&
              !!result.ok &&
              normalizeAssetKind(result.ok.asset_kind) === 'FT' &&
              result.ok.status === 'Active',
            {
              attempts: 10,
              delayMs: 1_200,
              label: `${tokenSymbol} basket ${basketId} readiness`,
            },
          );
        }
      }

      // Calculate index at creation from snapshot (needed for betting)
      const snapshot = createSnapshot(items, marketProbabilities);
      const snapshotIndex = snapshot.basketIndex;
      const indexAtCreationBps = Math.max(1, Math.min(10000, Math.round(snapshotIndex * 10000)));

      console.log(`[SaveBasketButton] Basket created with ID: ${basketId}, calculated snapshot index: ${snapshotIndex} (${indexAtCreationBps} bps)`);

      // IMPORTANT: Always place a bet if bet amount is provided
      // If no bet amount, user will need to bet separately (but warn them)
      if (betAmount && betAmountNum > 0) {
        console.log(`[SaveBasketButton] Bet amount provided: ${betAmountNum}, placing bet for basket ${basketId}`);
        try {
          if (assetKind === 'FT') {
            if (!api || !account) {
              throw new Error(`Wallet is not ready for ${tokenSymbol} betting`);
            }
            if (!walletActorId) {
              throw new Error(`Wallet actor ID is not available for ${tokenSymbol} betting`);
            }

            const betTokenProgram = betTokenProgramFromApi(api);
            const betLaneProgram = betLaneProgramFromApi(api);
            const betUnits = toTokenUnits(betAmount, tokenDecimals);
            const signedQuote = await requestBetQuote({
              targetProgramId: betLaneProgram.programId,
              user: walletActorId,
              basketId,
              amount: betUnits.toString(),
            });
            const liveAllowance = toBigIntValue(
              await withRateLimitRetry(
                () =>
                  readSailsQuery(
                    betTokenProgram.betToken.allowance(walletActorId, betLaneProgram.programId),
                  ),
                {
                  label: `${tokenSymbol} allowance query`,
                },
              ),
            );

            if (liveAllowance < betUnits) {
              const approveTx = betTokenProgram.betToken
                .approve(betLaneProgram.programId, betUnits)
                .withAccount(account.address, { signer: (account as any).signer });

              await withRateLimitRetry(() => approveTx.calculateGas(), {
                label: `${tokenSymbol} approve gas estimation`,
              });

              const placeBetTx = betLaneProgram.betLane
                .placeBet(basketId, betUnits, signedQuote)
                .withAccount(account.address, { signer: (account as any).signer })
                .withGas('max');

              await signAndSendBatch({
                api,
                account: account.address,
                signer: (account as any).signer,
                extrinsics: [approveTx.extrinsic, placeBetTx.extrinsic],
              });
            } else {
              const placeBetTx = betLaneProgram.betLane
                .placeBet(basketId, betUnits, signedQuote)
                .withAccount(account.address, { signer: (account as any).signer });

              try {
                await withRateLimitRetry(() => placeBetTx.calculateGas(), {
                  label: `${tokenSymbol} bet gas estimation`,
                });
              } catch (gasError) {
                throw new Error(
                  gasError instanceof Error
                    ? `${tokenSymbol} bet simulation failed: ${gasError.message}`
                    : `${tokenSymbol} bet simulation failed`
                );
              }
              const { response: placeBetResponse } = await withRateLimitRetry(
                () => placeBetTx.signAndSend(),
                {
                  label: `${tokenSymbol} bet transaction submission`,
                  baseDelayMs: 1_500,
                },
              );
              await withRateLimitRetry(() => placeBetResponse(), {
                label: `${tokenSymbol} bet transaction response`,
              });
            }
            await waitForQueryMatch(
              async () =>
                readSailsQuery(betLaneProgram.betLane.getPosition(walletActorId, basketId)),
              (position) => toBigIntValue(position?.shares) >= betUnits,
              {
                attempts: 10,
                delayMs: 1_200,
                label: `${tokenSymbol} position for basket ${basketId}`,
              },
            );
            await withRateLimitRetry(() => betBalanceQuery.refetch(), {
              label: `${tokenSymbol} balance refresh`,
            });

            toast({
              title: `${tokenSymbol} Basket Created`,
              description: `Your basket "${name}" was created and funded with ${betAmountNum.toFixed(4)} ${tokenSymbol} at index ${(signedQuote.payload.quoted_index_bps / 100).toFixed(2)}%.`,
            });
          } else if (isVaraEth) {
            console.log('Placing bet on basket (Vara.eth)...', { basketId, betAmountWVara: betAmountNum });
            
            if (!varaEthBasketMarket) {
              throw new Error('Vara.eth basket market client not available');
            }
            
            console.log(`[SaveBasketButton] Using snapshot index for bet (Vara.eth): ${snapshotIndex} (${indexAtCreationBps} bps)`);
            
            const value = toWVara(betAmountNum);
            console.log(`[SaveBasketButton] Calling betOnBasket with:`, {
              basketId: BigInt(basketId),
              value: value.toString(),
              indexAtCreationBps,
              indexAtCreationPercent: (indexAtCreationBps / 100).toFixed(2) + '%'
            });
            
            const returnedShares = await varaEthBasketMarket.betOnBasket(BigInt(basketId), value, indexAtCreationBps);
            
            console.log(`[SaveBasketButton] ✅ Bet placed successfully on Vara.eth. Returned shares:`, returnedShares);
            const usdEquivalent = betCalculation ? formatUsd(betCalculation.totalUsd) : '';
            toast({
              title: 'Basket Created & Bet Placed!',
              description: `Your basket "${name}" was created and you bet ${betAmountNum.toFixed(4)} wVARA${usdEquivalent ? ` (${usdEquivalent})` : ''} on it at index ${(indexAtCreationBps / 100).toFixed(2)}%`,
            });
          } else {
            console.log('Placing bet on basket (Vara Network)...', { basketId, betAmountVara: betAmountNum });
            console.log(`[SaveBasketButton] Using snapshot index for bet: ${snapshotIndex} (${indexAtCreationBps} bps)`);
            console.log(`[SaveBasketButton] Calling betOnBasket with:`, {
              basketId,
              indexAtCreationBps,
              indexAtCreationPercent: (indexAtCreationBps / 100).toFixed(2) + '%',
              value: toVara(betAmountNum).toString(),
              account: account.address
            });
            
            const program = basketMarketProgramFromApi(api);
            const value = toVara(betAmountNum);
            const betTx = program.basketMarket
              .betOnBasket(basketId, indexAtCreationBps)
              .withAccount(account.address, { signer: (account as any).signer })
              .withValue(value);
            
            console.log(`[SaveBasketButton] Calculating gas for bet transaction...`);
            await withRateLimitRetry(() => betTx.calculateGas(), {
              label: 'VARA bet gas estimation',
            });
            console.log(`[SaveBasketButton] Gas calculated, signing and sending bet transaction...`);
            const { response: betResponse } = await withRateLimitRetry(() => betTx.signAndSend(), {
              label: 'VARA bet transaction submission',
              baseDelayMs: 1_500,
            });
            console.log(`[SaveBasketButton] Bet transaction sent, waiting for response...`);
            const betRes = await withRateLimitRetry(() => betResponse(), {
              label: 'VARA bet transaction response',
            });
            console.log(`[SaveBasketButton] Bet transaction response received:`, betRes);
            
            if (betRes && typeof betRes === 'object' && 'err' in betRes) {
              console.error(`[SaveBasketButton] ❌ Bet failed for basket ${basketId}:`, betRes.err);
              console.error(`[SaveBasketButton] Bet details:`, {
                basketId,
                indexAtCreationBps,
                indexAtCreationPercent: (indexAtCreationBps / 100).toFixed(2) + '%',
                betAmount: betAmountNum,
                value: value.toString()
              });
              toast({
                title: 'Basket Created',
                description: `Basket created successfully, but bet failed: ${betRes.err}. You can bet later from the basket page.`,
                variant: 'default',
              });
            } else {
              const returnedShares = betRes && typeof betRes === 'object' && 'ok' in betRes 
                ? (typeof betRes.ok === 'number' ? betRes.ok : typeof betRes.ok === 'string' ? parseFloat(betRes.ok) : Number(betRes.ok))
                : null;
              console.log(`[SaveBasketButton] ✅ Bet placed successfully for basket ${basketId}:`, {
                returnedShares,
                indexAtCreationBps,
                indexAtCreationPercent: (indexAtCreationBps / 100).toFixed(2) + '%',
                betAmount: betAmountNum
              });
              const usdEquivalent = betCalculation ? formatUsd(betCalculation.totalUsd) : '';
              toast({
                title: 'Basket Created & Bet Placed!',
                description: `Your basket "${name}" was created and you bet ${betAmountNum.toFixed(2)} TVARA${usdEquivalent ? ` (${usdEquivalent})` : ''} on it at index ${(indexAtCreationBps / 100).toFixed(2)}%`,
              });
            }
          }
        } catch (betError: any) {
          console.error(`[SaveBasketButton] ❌ Bet transaction failed for basket ${basketId}:`, betError);
          console.error(`[SaveBasketButton] Bet error details:`, {
            error: betError?.message || String(betError),
            stack: betError?.stack,
            basketId,
            snapshotIndexBps: indexAtCreationBps,
            betAmount: betAmountNum,
            network: isVaraEth ? 'Vara.eth' : 'Vara Network'
          });
          toast({
            title: 'Basket Created',
            description: isRateLimitError(betError)
              ? 'Basket created successfully, but the wallet or RPC provider hit a rate limit while placing the bet. Wait a few seconds and try the bet again from the basket page.'
              : `Basket created successfully, but bet failed: ${betError?.message || 'Unknown error'}. You can bet later from the basket page.`,
            variant: 'default',
          });
        }
      } else {
        // No bet amount provided - warn user
        console.warn(`[SaveBasketButton] ⚠️ Basket ${basketId} created without bet amount. User needs to bet separately to participate.`);
        toast({
          title: 'Basket Created',
          description: `Basket created successfully! Remember to place a bet to participate in this basket.`,
          variant: 'default',
        });
      }

      // Save metadata to localStorage (tags, snapshot) linked to on-chain basket ID
      const onchainBasketId = `onchain-${basketId}`;
      
      // Create basket entry with on-chain ID
      const basket: Basket = {
        id: onchainBasketId,
        owner: address,
        name,
        description,
        tags,
        createdAt: Date.now(),
        items,
        createdSnapshot: snapshot,
        network,
        assetKind,
      };

      // Save to localStorage
      const baskets = getBaskets();
      baskets.push(basket);
      localStorage.setItem('polybaskets_baskets', JSON.stringify(baskets));

      setStatus('finalized');
      
      if (!betAmount || betAmountNum === 0) {
        toast({
          title: 'Basket Created!',
          description: `Your basket "${name}" has been created on-chain with ID ${basketId}`,
        });
      }

      clearBasket();
      
      // Navigate to basket page (using on-chain ID)
      setTimeout(() => {
        navigate(`/basket/${onchainBasketId}`);
      }, 500);

    } catch (error) {
      console.error('Failed to create basket:', error);
      toast({
        title: 'Creation Failed',
        description: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
      setStatus('idle');
    }
  };

  const getStatusDisplay = () => {
    switch (status) {
      case 'submitted':
        return (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Submitting...
          </>
        );
      case 'accepted':
        return (
          <>
            <Clock className="w-4 h-4" />
            Accepted (not final)
          </>
        );
      case 'finalized':
        return (
          <>
            <CheckCircle2 className="w-4 h-4" />
            Finalized ✓
          </>
        );
      default:
        return (
          <>
            <Save className="w-4 h-4" />
            Save on {config.name}
          </>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Bet Amount Input */}
      <div className="space-y-2">
        <Label htmlFor="bet-amount" className="text-sm font-medium">
          Bet Amount ({assetKind === 'FT' ? tokenSymbol : isVaraEth ? 'wVARA' : 'TVARA'}) <span className="text-muted-foreground font-normal">{assetKind === 'FT' || !varaEnabled ? '(Required)' : '(Optional)'}</span>
        </Label>
        <Input
          id="bet-amount"
          type="number"
          placeholder="0.0"
          value={betAmount}
          onChange={(e) => setBetAmount(e.target.value)}
          min="0"
          max={assetKind === 'FT' ? fromTokenUnits(betBalanceUnits, tokenDecimals, tokenDecimals) : undefined}
          step="0.1"
          disabled={status !== 'idle'}
          className="w-full"
        />
        {hasInsufficientFtBalance && (
          <p className="text-sm text-destructive">
            Not enough {tokenSymbol}. Enter {fromTokenUnits(betBalanceUnits, tokenDecimals)} {tokenSymbol} or less.
          </p>
        )}
        {betCalculation && betCalculation.allocations.length > 0 && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total:</span>
              <span className="font-semibold">
                {assetKind === 'FT'
                  ? `${betAmountNum.toFixed(4)} ${tokenSymbol}`
                  : `${formatVara(betCalculation.totalVara)} (${formatUsd(betCalculation.totalUsd)})`}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
            </div>
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="text-xs text-muted-foreground mb-1">
                {assetKind === 'FT'
                  ? `Allocation by market (weight split in ${tokenSymbol}):`
                  : 'Allocation by market (based on weights):'}
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {betCalculation.allocations.map((alloc, idx) => {
                  const item = items.find(i => i.marketId === alloc.marketId);
                  const betAllocation = (betAmountNum * alloc.weightBps) / 10_000;
                  return (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1" title={item?.question}>
                        {item?.question.slice(0, 30)}...
                      </span>
                      <span className="ml-2 font-medium tabular-nums">
                        {assetKind === 'FT'
                          ? `${betAllocation.toFixed(4)} ${tokenSymbol}`
                          : formatVara(alloc.varaAmount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {varaEnabled ? (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Settlement Asset</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={assetKind === 'Vara' ? 'default' : 'outline'}
            onClick={() => setAssetKind('Vara')}
            disabled={status !== 'idle'}
            className="justify-between"
          >
            <span>VARA</span>
          </Button>
            <Button
              type="button"
              variant={assetKind === 'FT' ? 'default' : 'outline'}
              onClick={() => setAssetKind('FT')}
            disabled={status !== 'idle' || isVaraEth || !betProgramsConfigured}
            className="justify-between"
          >
            <span>{tokenSymbol}</span>
          </Button>
          </div>
          {isVaraEth && (
            <p className="text-xs text-muted-foreground">
              {tokenSymbol} baskets are currently disabled on Vara.eth.
            </p>
          )}
          {!isVaraEth && !betProgramsConfigured && (
            <p className="text-xs text-muted-foreground">
              Configure {tokenSymbol} token and lane contract IDs to enable {tokenSymbol} baskets.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Settlement Asset</Label>
          <div className="rounded-lg border bg-muted/20 p-3 font-medium">{tokenSymbol}</div>
        </div>
      )}

      {/* Save Button */}
        <Button
          onClick={handleSave}
          disabled={isSaveDisabled}
        className="w-full gap-2"
        size="lg"
      >
          {manualBettingEnabled ? getStatusDisplay() : (
            <>
              <Circle className="w-4 h-4" />
              Agent Only
            </>
          )}
        </Button>
        {!manualBettingEnabled && (
          <p className="text-xs text-muted-foreground">
            Basket creation from the web UI is disabled. Send the create-and-bet flow through your agent.
          </p>
        )}
      {disabledReason && (
        <p className="text-sm text-muted-foreground">{disabledReason}</p>
      )}
      
      {status !== 'idle' && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {network === 'vara' ? (
            <img src="/toggle.png" alt="Vara Network" className="w-4 h-4 object-contain" />
          ) : (
            <Circle className="w-2 h-2 fill-blue-500 text-blue-500" />
          )}
          {config.name}
        </div>
      )}
    </div>
  );
}
