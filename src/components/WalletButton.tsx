import { Wallet } from '@gear-js/wallet-connect';
import { useNetwork } from '@/contexts/NetworkContext.tsx';
import { useWallet } from '@/contexts/WalletContext.tsx';
import { Button } from '@/components/ui/button.tsx';
import { isMetaMaskInstalled } from '@/lib/evmWallet.ts';
import { Wallet as WalletIcon } from 'lucide-react';

export function WalletButton() {
  const { network } = useNetwork();
  const { address, isConnecting, connect, disconnect } = useWallet();
  const buttonClassName = 'wallet-button-primary whitespace-nowrap gap-2';

  // Keep wallet CTA consistent across header and pages.
  if (network === 'vara') {
    return (
      <div className={buttonClassName}>
        <Wallet theme="gear" />
      </div>
    );
  }

  if (!isMetaMaskInstalled()) {
    return (
      <Button
        className={buttonClassName}
        onClick={() => window.open('https://metamask.io/download/', '_blank')}
      >
        <WalletIcon className="w-4 h-4" />
        Install MetaMask
      </Button>
    );
  }

  if (address) {
    return (
      <Button
        className={buttonClassName}
        onClick={disconnect}
      >
        <WalletIcon className="w-4 h-4" />
        {address.slice(0, 6)}...{address.slice(-4)}
      </Button>
    );
  }

  return (
    <Button
      className={buttonClassName}
      onClick={connect}
      disabled={isConnecting}
    >
      <WalletIcon className="w-4 h-4" />
      {isConnecting ? 'Connecting...' : 'Connect Wallet'}
    </Button>
  );
}
