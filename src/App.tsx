import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { NetworkProvider, useNetwork } from "@/contexts/NetworkContext";
import { WalletProvider } from "@/contexts/WalletContext";
import { BasketProvider } from "@/contexts/BasketContext";
import { Header } from "@/components/layout/Header";
import Index from "./pages/Index";
import ExplorePage from "./pages/ExplorePage";
import ExplorerHoldPage from "./pages/ExplorerHoldPage";
import BuilderPage from "./pages/BuilderPage";
import ClaimPage from "./pages/ClaimPage";
import BasketPage from "./pages/BasketPage";
import MyBasketsPage from "./pages/MyBasketsPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import StatsPage from "./pages/StatsPage";
import AgentProfilePage from "./pages/AgentProfilePage";
import AgentBasketsPage from "./pages/AgentBasketsPage";
// import DocsPage from "./pages/DocsPage"; // Hidden for now
import NotFound from "./pages/NotFound";
import { ApiProvider, AlertProvider, AccountProvider } from "@gear-js/react-hooks";
import { Alert, alertStyles } from "@gear-js/vara-ui";
import { ENV } from "./env";
import { ReactNode } from "react";
import { Send } from "lucide-react";

const queryClient = new QueryClient();

function AppRoutes() {
  const hostname = window.location.hostname;
  const isAppHost = hostname === "app.polybaskets.xyz";
  const isExplorerHoldEnabled = ENV.EXPLORER_HOLD_ENABLED;
  const holdPage = <ExplorerHoldPage />;
  const explorerEntryPage = isExplorerHoldEnabled ? holdPage : <ExplorePage />;
  const builderEntryPage = isExplorerHoldEnabled ? holdPage : <BuilderPage />;
  const claimEntryPage = isExplorerHoldEnabled ? holdPage : <ClaimPage />;
  const leaderboardEntryPage = isExplorerHoldEnabled ? holdPage : <LeaderboardPage />;
  const basketsEntryPage = isExplorerHoldEnabled ? holdPage : <MyBasketsPage />;

  return (
    <Routes>
      <Route
        path="/"
        element={isAppHost ? <Navigate to="/explorer" replace /> : <Index />}
      />
      <Route path="/explorer" element={explorerEntryPage} />
      <Route path="/builder" element={builderEntryPage} />
      <Route path="/claim" element={claimEntryPage} />
      <Route path="/basket/:id" element={<BasketPage />} />
      <Route path="/me" element={basketsEntryPage} />
      <Route path="/leaderboard" element={leaderboardEntryPage} />
      <Route path="/stats" element={<StatsPage />} />
      <Route path="/agents/:actorId" element={<AgentProfilePage />} />
      <Route path="/agents/:actorId/baskets/:view" element={<AgentBasketsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function TelegramUpdatesCta() {
  return (
    <a
      href="https://t.me/polybaskets"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Join PolyBaskets on Telegram"
      className="fixed bottom-20 right-4 md:bottom-4 z-40 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/90 px-4 py-2 text-sm font-medium text-primary shadow-[0_0_24px_rgba(132,255,0,0.12)] backdrop-blur-md transition-all duration-200 hover:border-primary/70 hover:bg-background hover:text-primary hover:shadow-[0_0_28px_rgba(132,255,0,0.2)]"
    >
      <Send className="h-4 w-4" />
      <span>Get Updates</span>
    </a>
  );
}

function RoutedLayout() {
  const location = useLocation();

  if (location.pathname === "/") {
    return (
      <>
        <AppRoutes />
        <TelegramUpdatesCta />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background bg-pattern scanlines relative">
      <div className="fixed inset-0 pointer-events-none -z-10" />
      <Header />
      <AppRoutes />
      <TelegramUpdatesCta />
    </div>
  );
}

// Conditional Gear providers - only for Vara Network
function GearProviders({ children }: { children: ReactNode }) {
  return (
    <ApiProvider initialArgs={{ endpoint: ENV.NODE_ADDRESS }}>
      <AlertProvider template={Alert} containerClassName={alertStyles.root}>
        <AccountProvider appName="Polybaskets">
          {children}
        </AccountProvider>
      </AlertProvider>
    </ApiProvider>
  );
}

// Inner app component that uses network context
function AppInner() {
  const { network } = useNetwork();

  // Ensure providers are always in the same order regardless of network
  const appContent = (
    <WalletProvider>
      <BasketProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <RoutedLayout />
          </BrowserRouter>
        </TooltipProvider>
      </BasketProvider>
    </WalletProvider>
  );

  // Wrap with Gear providers only for Vara Network
  // This should not affect BasketProvider availability
  if (network === 'vara') {
    return <GearProviders>{appContent}</GearProviders>;
  }

  // For Vara.eth, no Gear providers needed
  return appContent;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <NetworkProvider>
      <AppInner />
    </NetworkProvider>
  </QueryClientProvider>
);

export default App;
