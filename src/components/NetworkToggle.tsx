import { useNetwork } from '@/contexts/NetworkContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Circle } from 'lucide-react';

export function NetworkToggle() {
  const { network, config, setNetwork } = useNetwork();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {network === 'vara' ? (
            <img src="/toggle.png" alt="Vara Network" className="w-4 h-4 object-contain" />
          ) : (
            <Circle className="w-2 h-2 fill-blue-500 text-blue-500" />
          )}
          <span className="hidden sm:inline">{config.name}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem 
          onClick={() => setNetwork('vara')}
          className="gap-2 cursor-pointer"
        >
          <img src="/toggle.png" alt="Vara Network" className="w-4 h-4 object-contain" />
          Vara Network
        </DropdownMenuItem>
        <DropdownMenuItem 
          disabled
          className="gap-2 cursor-not-allowed opacity-50"
          onSelect={(e) => e.preventDefault()}
        >
          <Circle className="w-2 h-2 fill-blue-500 text-blue-500" />
          <span>Vara.eth <span className="text-xs text-muted-foreground">(Coming Soon)</span></span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
