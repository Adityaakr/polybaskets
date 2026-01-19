import { Wallet } from '@gear-js/wallet-connect';
import { useNetwork } from '@/contexts/NetworkContext';
import { useWallet } from '@/contexts/WalletContext';
import { Button } from '@/components/ui/button';
import { isMetaMaskInstalled } from '@/lib/evmWallet';
import { Wallet as WalletIcon } from 'lucide-react';

export function WalletButton() {
  const { network } = useNetwork();
  const { address, isConnecting, connect, disconnect } = useWallet();

  // For Vara Network, use Gear wallet component
  if (network === 'vara') {
    return <Wallet />;
  }

  // For Vara.eth, use MetaMask
  if (!isMetaMaskInstalled()) {
    return (
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => window.open('https://metamask.io/download/', '_blank')}
      >
        <WalletIcon className="w-4 h-4 mr-2" />
        Install MetaMask
      </Button>
    );
  }

  if (address) {
    return (
      <Button 
        variant="outline" 
        size="sm"
        onClick={disconnect}
      >
        <WalletIcon className="w-4 h-4 mr-2" />
        {address.slice(0, 6)}...{address.slice(-4)}
      </Button>
    );
  }

  return (
    <Button 
      variant="default" 
      size="sm"
      onClick={connect}
      disabled={isConnecting}
    >
      <WalletIcon className="w-4 h-4 mr-2" />
      {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
    </Button>
  );
}
