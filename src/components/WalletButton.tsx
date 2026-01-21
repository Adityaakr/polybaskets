import { Wallet } from '@gear-js/wallet-connect';
import { useNetwork } from '@/contexts/NetworkContext';
import { useWallet } from '@/contexts/WalletContext';
import { Button } from '@/components/ui/button';
import { isMetaMaskInstalled } from '@/lib/evmWallet';
import { Wallet as WalletIcon } from 'lucide-react';

export function WalletButton() {
  const { network } = useNetwork();
  const { address, isConnecting, connect, disconnect } = useWallet();

  // For Vara Network, use Gear wallet component with compact styling
  if (network === 'vara') {
    return (
      <div className="gear-wallet-compact [&_button]:!h-8 [&_button]:!px-3 [&_button]:!py-1 [&_button]:!text-xs [&_button]:!rounded-md [&_button]:!whitespace-nowrap [&_button]:!min-w-0 [&_button]:!text-black [&_button]:!font-medium">
        <Wallet />
      </div>
    );
  }

  // For Vara.eth, use MetaMask
  if (!isMetaMaskInstalled()) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="whitespace-nowrap h-8 px-2 text-xs rounded-md"
        onClick={() => window.open('https://metamask.io/download/', '_blank')}
      >
        <WalletIcon className="w-4 h-4 mr-1" />
        Connect
      </Button>
    );
  }

  if (address) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="whitespace-nowrap h-8 px-2 text-xs rounded-md"
        onClick={disconnect}
      >
        <WalletIcon className="w-4 h-4 mr-1" />
        {address.slice(0, 6)}...{address.slice(-4)}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="whitespace-nowrap h-8 px-2 text-xs rounded-md"
      onClick={connect}
      disabled={isConnecting}
    >
      <WalletIcon className="w-4 h-4 mr-1" />
      {isConnecting ? 'Connecting...' : 'Connect'}
    </Button>
  );
}
