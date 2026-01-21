import { PolymarketMarket } from '@/types/polymarket';
import { Outcome } from '@/types/basket';
import { getOutcomeProbabilities, getOutcomePrices, formatVolume, formatProbability, formatPrice, formatCategoryName } from '@/lib/polymarket';
import { useBasket } from '@/contexts/BasketContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Check, ExternalLink, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface MarketCardProps {
  market: PolymarketMarket;
}

export function MarketCard({ market }: MarketCardProps) {
  const { addItem, hasItem } = useBasket();
  const probs = getOutcomeProbabilities(market);
  const prices = getOutcomePrices(market);
  
  // Get outcome labels from market data (e.g., "Up"/"Down" instead of "YES"/"NO")
  const outcomeLabels = {
    YES: market.outcomes?.[0] || 'YES',
    NO: market.outcomes?.[1] || 'NO',
  };
  
  // Truncate long labels for buttons (max 8 chars)
  const truncateLabel = (label: string, max = 8) => 
    label.length > max ? label.slice(0, max) + '…' : label;
  
  const shortLabels = {
    YES: truncateLabel(outcomeLabels.YES),
    NO: truncateLabel(outcomeLabels.NO),
  };
  
  // Check if this is an "Up or Down" style market
  const isUpDownMarket = market.question?.toLowerCase().includes('up or down');

  const handleAdd = (outcome: Outcome) => {
    addItem(market, outcome);
  };

  const yesSelected = hasItem(market.id, 'YES');
  const noSelected = hasItem(market.id, 'NO');

  // Construct Polymarket URL
  const polymarketUrl = market.slug 
    ? `https://polymarket.com/event/${market.slug}`
    : `https://polymarket.com/event/${market.id}`;

  return (
    <Card className="card-elevated card-hover overflow-hidden border-border/50 relative group">
      {/* External link icon in top-right corner */}
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
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {market.category && (
                <Badge variant="secondary" className="text-xs font-medium bg-primary/10 text-primary border-primary/20">
                  {formatCategoryName(market.category)}
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
            {/* Show what each outcome means for clarity */}
            {isUpDownMarket && (
              <p className="text-xs text-muted-foreground mt-1">
                {outcomeLabels.YES} = price goes up • {outcomeLabels.NO} = price goes down
              </p>
            )}
          </div>
        </div>

        {/* Prices & Probabilities - Show actual outcome labels */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-gradient-to-br from-success/20 to-success/5 rounded-md p-3 text-center border border-success/30 transition-all duration-300 hover:border-success/50">
            <div className="text-xl font-mono font-semibold tabular-nums text-success">
              {formatProbability(probs.YES)}
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 truncate" title={outcomeLabels.YES}>
              {shortLabels.YES} {prices && <span className="opacity-75">({formatPrice(prices.YES)})</span>}
            </div>
          </div>
          <div className="bg-gradient-to-br from-secondary to-secondary/80 rounded-md p-3 text-center border border-border transition-all duration-300 hover:border-primary/30">
            <div className="text-xl font-mono font-semibold tabular-nums">
              {formatProbability(probs.NO)}
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 truncate" title={outcomeLabels.NO}>
              {shortLabels.NO} {prices && <span className="opacity-75">({formatPrice(prices.NO)})</span>}
            </div>
          </div>
        </div>

        {/* Stats - Always show volume and liquidity */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
          <span>Vol: {market.volume ? formatVolume(market.volume) : '$0'}</span>
          <span>Liq: {market.liquidity ? formatVolume(market.liquidity) : '$0'}</span>
          {market.endDate && (
            <span className="ml-auto text-xs">
              Ends: {new Date(market.endDate).toLocaleString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
              })}
            </span>
          )}
        </div>

        {/* Actions - Use truncated outcome labels */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={yesSelected ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleAdd('YES')}
            disabled={yesSelected}
            className="gap-1 text-xs overflow-hidden"
            title={`Add ${outcomeLabels.YES}`}
          >
            {yesSelected ? (
              <>
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">Added</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">+ {shortLabels.YES}</span>
              </>
            )}
          </Button>
          <Button
            variant={noSelected ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleAdd('NO')}
            disabled={noSelected}
            className="gap-1 text-xs overflow-hidden"
            title={`Add ${outcomeLabels.NO}`}
          >
            {noSelected ? (
              <>
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">Added</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">+ {shortLabels.NO}</span>
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
