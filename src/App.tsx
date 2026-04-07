import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { NetworkProvider, useNetwork } from "@/contexts/NetworkContext";
import { WalletProvider } from "@/contexts/WalletContext";
import { BasketProvider } from "@/contexts/BasketContext";
import { Header } from "@/components/layout/Header";
import Index from "./pages/Index";
import BuilderPage from "./pages/BuilderPage";
import ClaimPage from "./pages/ClaimPage";
import BasketPage from "./pages/BasketPage";
import MyBasketsPage from "./pages/MyBasketsPage";
import LeaderboardPage from "./pages/LeaderboardPage";
// import DocsPage from "./pages/DocsPage"; // Hidden for now
import NotFound from "./pages/NotFound";
import { ApiProvider, AlertProvider, AccountProvider } from "@gear-js/react-hooks";
import { Alert, alertStyles } from "@gear-js/vara-ui";
import { ENV } from "./env";
import { ReactNode } from "react";
import { Send } from "lucide-react";

const queryClient = new QueryClient();

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
            <div className="min-h-screen bg-background bg-pattern scanlines relative">
              {/* Neon grid overlay */}
              <div className="fixed inset-0 pointer-events-none -z-10" />
              <Header />
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/builder" element={<BuilderPage />} />
                <Route path="/claim" element={<ClaimPage />} />
                <Route path="/basket/:id" element={<BasketPage />} />
                <Route path="/me" element={<MyBasketsPage />} />
                <Route path="/leaderboard" element={<LeaderboardPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              <a
                href="https://t.me/polybaskets"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Join PolyBaskets on Telegram"
                className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/90 px-4 py-2 text-sm font-medium text-primary shadow-[0_0_24px_rgba(132,255,0,0.12)] backdrop-blur-md transition-all duration-200 hover:border-primary/70 hover:bg-background hover:text-primary hover:shadow-[0_0_28px_rgba(132,255,0,0.2)]"
              >
                <Send className="h-4 w-4" />
                <span>Get Updates</span>
              </a>
            </div>
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
