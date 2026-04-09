import { Link, useLocation } from 'react-router-dom';
import { NetworkToggle } from '@/components/NetworkToggle';
import { WalletButton } from '@/components/WalletButton';

const NAV_ITEMS = [
  { path: '/explorer', label: 'Explore' },
  { path: '/builder', label: 'Builder' },
  { path: '/claim', label: 'Claim' },
  { path: '/leaderboard', label: 'Leaderboard' },
  { path: '/me', label: 'Baskets' },
];

export function Header() {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full bg-card/90 backdrop-blur-xl border-b border-primary/30 shadow-[0_0_20px_hsl(120_100%_50%_/_0.1)]">
      <div className="content-grid flex items-center justify-between h-16">
        {/* Logo */}
        <Link to="/" className="group flex items-center gap-0">
          <img
            src="/poly.png"
            alt=""
            aria-hidden="true"
            className="h-[60px] w-[60px] shrink-0 object-contain drop-shadow-[0_0_12px_rgba(132,255,0,0.18)]"
          />
          <span className="-ml-2 font-display font-bold text-2xl gradient-text tracking-tight transition-transform duration-300 group-hover:scale-105">PolyBaskets</span>
        </Link>

        {/* Navigation */}
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
        <div className="flex items-center gap-5 ml-8">
          <NetworkToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
