import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { NetworkToggle } from '@/components/NetworkToggle';
import { WalletButton } from '@/components/WalletButton';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

const NAV_ITEMS = [
  { path: '/explorer', label: 'Explore' },
  { path: '/builder', label: 'Builder' },
  { path: '/claim', label: 'Claim' },
  { path: '/leaderboard', label: 'Leaderboard' },
  { path: '/me', label: 'Baskets' },
];

export function Header() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className="sticky top-0 z-50 w-full bg-card/90 backdrop-blur-xl border-b border-primary/30 shadow-[0_0_20px_hsl(120_100%_50%_/_0.1)]">
      <div className="content-grid flex items-center justify-between h-16">
        {/* Logo */}
        <Link to="/" className="group flex items-center gap-0">
          <img
            src="/poly-1.png"
            alt="PolyBaskets"
            className="h-[40px] w-[40px] md:h-[60px] md:w-[60px] shrink-0 object-contain drop-shadow-[0_0_12px_rgba(132,255,0,0.18)]"
          />
          <span className="hidden sm:inline -ml-2 font-display font-bold text-2xl gradient-text tracking-tight transition-transform duration-300 group-hover:scale-105">PolyBaskets</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-3 ml-8">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`px-5 py-2 text-sm font-medium rounded-md transition-all duration-200 relative ${
                location.pathname === item.path
                  ? 'bg-primary text-primary-foreground shadow-[0_0_15px_hsl(120_100%_50%_/_0.4)]'
                  : 'text-muted-foreground hover:text-primary hover:bg-secondary/80 hover:shadow-[0_0_10px_hsl(120_100%_50%_/_0.2)]'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 md:gap-5">
          <div className="hidden md:block">
            <NetworkToggle />
          </div>
          <div className="max-w-[160px] md:max-w-none overflow-hidden">
            <WalletButton />
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden flex items-center justify-center min-h-[44px] min-w-[44px] text-primary"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Mobile Sheet Navigation */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="right"
          className="bg-card border-l border-primary/30 shadow-[0_0_20px_hsl(120_100%_50%_/_0.1)] w-4/5 sm:max-w-sm p-0"
        >
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <nav className="flex flex-col pt-14 px-4">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-4 py-3 text-base font-medium rounded-md transition-all duration-200 ${
                  location.pathname === item.path
                    ? 'bg-primary text-primary-foreground shadow-[0_0_15px_hsl(120_100%_50%_/_0.4)]'
                    : 'text-muted-foreground hover:text-primary hover:bg-secondary/80'
                }`}
              >
                {item.label}
              </Link>
            ))}

            <div className="my-4 border-t border-border" />

            <div className="px-4">
              <NetworkToggle />
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
