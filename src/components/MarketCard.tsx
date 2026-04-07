import { useState, useEffect, useRef } from 'react';
import { PolymarketMarket } from '@/types/polymarket.ts';
import { Outcome } from '@/types/basket.ts';
import { getOutcomeProbabilities, getOutcomePrices, formatVolume, formatProbability, formatPrice, formatCategoryName } from '@/lib/polymarket.ts';
import { useBasket } from '@/contexts/BasketContext';
import { useCountdown } from '@/hooks/useCountdown';
import { useCryptoPrice, fmtCryptoPrice } from '@/hooks/useCryptoPrice';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Check, ExternalLink, Info, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils.ts';

interface MarketCardProps {
  market: PolymarketMarket;
  index?: number;
}

export function MarketCard({ market, index = 0 }: MarketCardProps) {
  const { addItem, hasItem } = useBasket();
  const probs = getOutcomeProbabilities(market);
  const prices = getOutcomePrices(market);
  const countdown = useCountdown(market.endDate);

  const isUpDownMarket = market.question?.toLowerCase().includes('up or down')
    || market.outcomes?.some(o => /^(up|down)$/i.test(o));

  const { price: livePrice, prevPrice, direction } = useCryptoPrice(
    isUpDownMarket ? market.question : undefined
  );

  // Only show "Price to Beat" if we have REAL data from the API
  const priceToBeat = market.priceToBeat || null;

  const prevYesRef = useRef(probs.YES);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (probs.YES !== prevYesRef.current) {
      setFlash(probs.YES > prevYesRef.current ? 'up' : 'down');
      prevYesRef.current = probs.YES;
      const timer = setTimeout(() => setFlash(null), 600);
      return () => clearTimeout(timer);
    }
  }, [probs.YES]);
  
  const outcomeLabels = {
    YES: market.outcomes?.[0] || 'YES',
    NO: market.outcomes?.[1] || 'NO',
  };
  
  const truncateLabel = (label: string, max = 6) => 
    label.length > max ? label.slice(0, max).trim() + '…' : label;
  
  const shortLabels = {
    YES: truncateLabel(outcomeLabels.YES),
    NO: truncateLabel(outcomeLabels.NO),
  };

  const handleAdd = (outcome: Outcome) => {
    addItem(market, outcome);
  };

  const yesSelected = hasItem(market.id, 'YES');
  const noSelected = hasItem(market.id, 'NO');

  const polymarketUrl = market.slug 
    ? `https://polymarket.com/event/${market.slug}`
    : `https://polymarket.com/event/${market.id}`;

  // Compute price-to-beat comparison
  const ptbNum = priceToBeat ? parseFloat(priceToBeat.replace(/[$,]/g, '')) : null;
  const priceVsBeat = livePrice && ptbNum
    ? livePrice > ptbNum ? 'above' : livePrice < ptbNum ? 'below' : 'equal'
    : null;

  return (
    <Card
      className="card-elevated card-hover overflow-hidden border-border/50 relative group animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{ animationDelay: `${Math.min(index * 50, 300)}ms`, animationFillMode: 'backwards' }}
    >
      <a
        href={polymarketUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1.5 rounded-md bg-background/80 hover:bg-background border border-border/50 hover:border-primary/50 backdrop-blur-sm"
        title="View on Polymarket"
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors" />
      </a>
      
      <CardContent className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          {market.image && (
            <img
              src={market.image}
              alt=""
              className="w-8 h-8 rounded-full object-cover border border-border/50 flex-shrink-0 mt-0.5"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {market.category && (
                <Badge variant="secondary" className="text-xs font-medium bg-primary/10 text-primary border-primary/20">
                  {formatCategoryName(market.category)}
                </Badge>
              )}
              {market.active && !market.closed && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
              )}
              {market.volume24hr && market.volume24hr > 10000 && (
                <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/30 text-[10px] px-1.5 py-0">
                  Trending
                </Badge>
              )}
              {market.description && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      {market.description.slice(0, 200)}{market.description.length > 200 ? '...' : ''}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <h3 className="font-display font-semibold text-base leading-snug break-words" title={market.question}>
              {market.question}
            </h3>

            {/* ── Live Price Panel for Up/Down Markets ── */}
            {isUpDownMarket && livePrice != null && (
              <div className="mt-2.5 rounded-lg border border-border/60 overflow-hidden">
                {/* Price row */}
                <div className={cn(
                  "flex items-stretch",
                  priceToBeat ? "grid grid-cols-2" : ""
                )}>
                  {/* Price to Beat (only when API provides real data) */}
                  {priceToBeat && (
                    <div className="px-3 py-2 bg-muted/30 border-r border-border/40">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
                        Price to Beat
                      </div>
                      <div className="text-sm font-mono font-semibold tabular-nums text-muted-foreground">
                        {priceToBeat}
                      </div>
                    </div>
                  )}

                  {/* Live Price — animated */}
                  <div className={cn(
                    "px-3 py-2",
                    priceToBeat ? "bg-muted/20" : "bg-muted/30 flex-1"
                  )}>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5 flex items-center gap-1.5">
                      {priceToBeat ? 'Current Price' : 'Live Price'}
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Animated price with flash */}
                      <span
                        key={livePrice}
                        className={cn(
                          "text-sm font-mono font-bold tabular-nums transition-colors duration-300",
                          direction === 'up' && "animate-price-flash-green",
                          direction === 'down' && "animate-price-flash-red",
                          !direction && priceVsBeat === 'above' && "text-green-400",
                          !direction && priceVsBeat === 'below' && "text-red-400",
                          !direction && !priceVsBeat && "text-foreground",
                        )}
                      >
                        {fmtCryptoPrice(livePrice)}
                      </span>

                      {/* Direction arrow badge */}
                      {direction && (
                        <span
                          key={`${direction}-${livePrice}`}
                          className={cn(
                            "inline-flex items-center gap-0.5 text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md animate-in fade-in zoom-in-95 duration-200",
                            direction === 'up'
                              ? "text-green-400 bg-green-500/15"
                              : "text-red-400 bg-red-500/15"
                          )}
                        >
                          {direction === 'up'
                            ? <TrendingUp className="w-2.5 h-2.5" />
                            : <TrendingDown className="w-2.5 h-2.5" />
                          }
                          {prevPrice != null && (
                            <>
                              {direction === 'up' ? '+' : ''}
                              {fmtCryptoPrice(Math.abs(livePrice - prevPrice)).slice(1)}
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Hint bar */}
                <div className="px-3 py-1 bg-muted/10 border-t border-border/30 text-[10px] text-muted-foreground/60">
                  {outcomeLabels.YES} wins if price is <span className="text-green-400/80 font-medium">higher</span> at close
                </div>
              </div>
            )}

            {isUpDownMarket && livePrice == null && (
              <p className="text-xs text-muted-foreground mt-1">
                {outcomeLabels.YES} = price goes up • {outcomeLabels.NO} = price goes down
              </p>
            )}
          </div>
        </div>

        {/* Prices & Probabilities */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-gradient-to-br from-success/20 to-success/5 rounded-md p-3 text-center border border-success/30 transition-all duration-300 hover:border-success/50 overflow-hidden">
            <div className={cn(
              "text-xl font-mono font-semibold tabular-nums text-success transition-all duration-300",
              flash === 'up' && "text-green-300 scale-105",
              flash === 'down' && "text-red-400"
            )}>
              {formatProbability(probs.YES)}
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 truncate" title={outcomeLabels.YES}>
              {shortLabels.YES} {prices && <span className="opacity-75">({formatPrice(prices.YES)})</span>}
            </div>
          </div>
          <div className="bg-gradient-to-br from-secondary to-secondary/80 rounded-md p-3 text-center border border-border transition-all duration-300 hover:border-primary/30 overflow-hidden">
            <div className={cn(
              "text-xl font-mono font-semibold tabular-nums transition-all duration-300",
              flash === 'down' && "text-green-300 scale-105",
              flash === 'up' && "text-red-400"
            )}>
              {formatProbability(probs.NO)}
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 truncate" title={outcomeLabels.NO}>
              {shortLabels.NO} {prices && <span className="opacity-75">({formatPrice(prices.NO)})</span>}
            </div>
          </div>
        </div>

        {/* Probability bar */}
        <div className="flex h-1.5 rounded-full overflow-hidden bg-muted mb-4">
          <div
            className="bg-green-500 transition-all duration-500 ease-out"
            style={{ width: `${(probs.YES * 100).toFixed(1)}%` }}
          />
          <div
            className="bg-muted-foreground/30 transition-all duration-500 ease-out"
            style={{ width: `${(probs.NO * 100).toFixed(1)}%` }}
          />
        </div>

        {/* Stats + Countdown */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
          <span>Vol: {market.volume ? formatVolume(market.volume) : '$0'}</span>
          <span>Liq: {market.liquidity ? formatVolume(market.liquidity) : '$0'}</span>
          {countdown && !countdown.expired ? (
            <span className={cn(
              "ml-auto font-mono text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1",
              countdown.isCritical && "bg-red-500/20 text-red-400 animate-pulse",
              countdown.isUrgent && !countdown.isCritical && "bg-amber-500/20 text-amber-400",
              !countdown.isUrgent && "bg-muted text-muted-foreground"
            )}>
              <Clock className="w-3 h-3" />
              {countdown.display}
            </span>
          ) : countdown?.expired ? (
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              Ended
            </span>
          ) : market.endDate ? (
            <span className="ml-auto text-xs">
              Ends: {new Date(market.endDate).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              })}
            </span>
          ) : null}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={yesSelected ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleAdd('YES')}
            disabled={yesSelected}
            className="w-full min-w-0 gap-1.5 text-xs"
            title={`Add ${outcomeLabels.YES}`}
          >
            {yesSelected ? (
              <>
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Added</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{shortLabels.YES}</span>
              </>
            )}
          </Button>
          <Button
            variant={noSelected ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleAdd('NO')}
            disabled={noSelected}
            className="w-full min-w-0 gap-1.5 text-xs"
            title={`Add ${outcomeLabels.NO}`}
          >
            {noSelected ? (
              <>
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Added</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{shortLabels.NO}</span>
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
