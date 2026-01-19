import { MarketSearch } from '@/components/MarketSearch';
import { useBasket } from '@/contexts/BasketContext';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, Layers } from 'lucide-react';

export default function ExplorePage() {
  // Use basket hook - BasketProvider wraps Routes in App.tsx
  const { items } = useBasket();

  return (
    <div className="content-grid py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 reveal">
        <div>
          <h1 className="text-5xl font-display font-bold mb-3 tracking-tight gradient-text">Explore Markets</h1>
          <p className="text-muted-foreground text-base">
            Discover Polymarket predictions and build your basket
          </p>
        </div>
        
        {items.length > 0 && (
          <Link to="/builder">
            <Button className="gap-2">
              <Layers className="w-4 h-4" />
              {items.length} in basket
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        )}
      </div>

      {/* Search & Results */}
      <MarketSearch />
    </div>
  );
}
