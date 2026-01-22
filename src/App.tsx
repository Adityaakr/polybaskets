import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { NetworkProvider, useNetwork } from "@/contexts/NetworkContext";
import { WalletProvider } from "@/contexts/WalletContext";
import { BasketProvider } from "@/contexts/BasketContext";
import { Header } from "@/components/layout/Header";
import { InviteGate } from "@/components/InviteGate";
import Index from "./pages/Index";
import BuilderPage from "./pages/BuilderPage";
import BasketPage from "./pages/BasketPage";
import MyBasketsPage from "./pages/MyBasketsPage";
import LeaderboardPage from "./pages/LeaderboardPage";
// import DocsPage from "./pages/DocsPage"; // Hidden for now
import NotFound from "./pages/NotFound";
import { ApiProvider, AlertProvider, AccountProvider } from "@gear-js/react-hooks";
import { Alert, alertStyles } from "@gear-js/vara-ui";
import { ENV } from "./env";
import { ReactNode } from "react";

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
                <Route path="/basket/:id" element={<BasketPage />} />
                <Route path="/me" element={<MyBasketsPage />} />
                <Route path="/leaderboard" element={<LeaderboardPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
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
  <InviteGate>
    <QueryClientProvider client={queryClient}>
      <NetworkProvider>
        <AppInner />
      </NetworkProvider>
    </QueryClientProvider>
  </InviteGate>
);

export default App;
