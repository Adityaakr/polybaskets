import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBasket } from '@/contexts/BasketContext';
import { useWallet } from '@/contexts/WalletContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useApi, useAccount } from '@gear-js/react-hooks';
import { getBaskets } from '@/lib/basket-storage';
import { Basket } from '@/types/basket';
import { createSnapshot, validateBasket } from '@/lib/basket-utils';
import { OutcomeProbabilities } from '@/types/polymarket';
import { basketMarketProgramFromApi, toVara } from '@/lib/varaClient';
import { calculateBetAllocationFromVara, calculateSuggestedBetAmount, formatVara, formatUsd, VARA_PRICE_USD } from '@/lib/betCalculator';
import { ENV } from '@/env';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Circle, CheckCircle2, Clock } from 'lucide-react';
import { useVaraEthBasketMarket } from '@/hooks/useVaraEthBasketMarket';
import { toWVara } from '@/lib/varaEthClient';

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
  
  const [status, setStatus] = useState<TxStatus>('idle');
  const [betAmount, setBetAmount] = useState('');
  
  const isVaraEth = network === 'varaeth';

  const errors = validateBasket(items, name);
  const isValid = errors.length === 0;
  
  // Calculate suggested bet amount based on basket composition
  const suggestedBetAmount = useMemo(() => {
    return calculateSuggestedBetAmount(items);
  }, [items]);
  
  // Auto-fill suggested bet amount when basket items change
  useEffect(() => {
    if (items.length > 0 && !betAmount) {
      setBetAmount(suggestedBetAmount.toString());
    }
  }, [items.length, suggestedBetAmount]); // Only trigger when items count changes, not on every render
  
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
  
  // Validate bet amount if provided
  const isValidBetAmount = !betAmount || (betAmountNum > 0 && !isNaN(betAmountNum));

  const handleSave = async () => {
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
    }

    try {
      setStatus('submitted');
      
      // Convert frontend basket items to contract format
      const contractItems = items.map(item => ({
        poly_market_id: item.marketId,
        poly_slug: item.slug,
        weight_bps: item.weightBps,
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
          .createBasket(name, description, contractItems)
          .withAccount(account.address, { signer: (account as any).signer });

        console.log('Calculating gas...');
        await tx.calculateGas();
        
        console.log('Signing and sending transaction...');
        const { response } = await tx.signAndSend();
        
        toast({
          title: 'Transaction Submitted',
          description: 'Your basket is being created on-chain...',
        });

        console.log('Waiting for response...');
        const res = await response();
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
      }

      // Calculate index at creation from snapshot (needed for betting)
      const snapshot = createSnapshot(items, marketProbabilities);
      const snapshotIndex = snapshot.basketIndex;
      const indexAtCreationBps = Math.max(1, Math.min(10000, Math.round(snapshotIndex * 10000)));

      console.log(`[SaveBasketButton] Basket created with ID: ${basketId}, calculated index at creation: ${snapshotIndex} (${indexAtCreationBps} bps)`);

      // IMPORTANT: Always place a bet if bet amount is provided
      // If no bet amount, user will need to bet separately (but warn them)
      if (betAmount && betAmountNum > 0) {
        console.log(`[SaveBasketButton] Bet amount provided: ${betAmountNum}, placing bet with index ${indexAtCreationBps} bps`);
        try {
          if (isVaraEth) {
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
            await betTx.calculateGas();
            console.log(`[SaveBasketButton] Gas calculated, signing and sending bet transaction...`);
            const { response: betResponse } = await betTx.signAndSend();
            console.log(`[SaveBasketButton] Bet transaction sent, waiting for response...`);
            const betRes = await betResponse();
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
            indexAtCreationBps,
            betAmount: betAmountNum,
            network: isVaraEth ? 'Vara.eth' : 'Vara Network'
          });
          toast({
            title: 'Basket Created',
            description: `Basket created successfully, but bet failed: ${betError?.message || 'Unknown error'}. You can bet later from the basket page.`,
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
          Bet Amount ({isVaraEth ? 'wVARA' : 'TVARA'}) <span className="text-muted-foreground font-normal">(Optional)</span>
        </Label>
        <Input
          id="bet-amount"
          type="number"
          placeholder="0.0"
          value={betAmount}
          onChange={(e) => setBetAmount(e.target.value)}
          min="0"
          step="0.1"
          disabled={status !== 'idle'}
          className="w-full"
        />
        {betCalculation && betCalculation.allocations.length > 0 && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total:</span>
              <span className="font-semibold">{formatVara(betCalculation.totalVara)} ({formatUsd(betCalculation.totalUsd)})</span>
            </div>
            <div className="text-xs text-muted-foreground">
            </div>
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="text-xs text-muted-foreground mb-1">Allocation by market (based on weights):</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {betCalculation.allocations.map((alloc, idx) => {
                  const item = items.find(i => i.marketId === alloc.marketId);
                  return (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1" title={item?.question}>
                        {item?.question.slice(0, 30)}...
                      </span>
                      <span className="ml-2 font-medium tabular-nums">{formatVara(alloc.varaAmount)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Bet amount is automatically calculated based on basket composition ({items.length} market{items.length !== 1 ? 's' : ''}, {items.length > 0 ? suggestedBetAmount : 0} {isVaraEth ? 'wVARA' : 'TVARA'} suggested). You can adjust this amount.
        </p>
      </div>

      {/* Save Button */}
      <Button
        onClick={handleSave}
        disabled={!isValid || !isValidBetAmount || status !== 'idle'}
        className="w-full gap-2"
        size="lg"
      >
        {getStatusDisplay()}
      </Button>
      
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
