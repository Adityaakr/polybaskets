import { useState } from 'react';
import { useAccount } from '@gear-js/react-hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { registrar, RegistrarError } from '@/lib/agentRegistrar';
import { buildAndSign } from '@/lib/agentSign';

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])?$/;

export function RegisterAgentDialog({
  trigger,
  onRegistered,
}: {
  trigger?: React.ReactNode;
  onRegistered?: (label: string) => void;
}) {
  const { account } = useAccount();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [twitter, setTwitter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [availability, setAvailability] = useState<
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'available' }
    | { state: 'unavailable'; reason: string }
  >({ state: 'idle' });

  async function checkAvailability(value: string) {
    if (!LABEL_RE.test(value) || value.length < 3 || value.length > 20) {
      setAvailability({
        state: 'unavailable',
        reason: 'Label must be 3–20 chars, lowercase a–z 0–9 and hyphen, no leading/trailing hyphen',
      });
      return;
    }
    setAvailability({ state: 'checking' });
    try {
      const r = await registrar.availability(value);
      if (r.available) setAvailability({ state: 'available' });
      else setAvailability({ state: 'unavailable', reason: r.reason ?? 'taken' });
    } catch {
      setAvailability({ state: 'idle' });
    }
  }

  async function submit() {
    if (!account) {
      toast({
        title: 'No wallet connected',
        description: 'Connect a Vara wallet to register a name.',
        variant: 'destructive',
      });
      return;
    }
    if (availability.state !== 'available') {
      toast({
        title: 'Pick an available label first',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const texts: Record<string, string> = {};
      if (displayName.trim()) texts.name = displayName.trim();
      if (bio.trim()) texts.description = bio.trim();
      if (twitter.trim()) texts['com.twitter'] = twitter.trim().replace(/^@/, '');

      const signedReq = await buildAndSign({
        account: { address: account.address, signer: (account as any).signer },
        action: 'register',
        label,
        texts: Object.keys(texts).length > 0 ? texts : undefined,
      });
      const result = await registrar.register(signedReq);
      toast({
        title: `Registered ${result.label}.polybaskets.eth`,
        description: 'It may take a few seconds to appear in lookups while ENS materializes.',
      });
      onRegistered?.(result.label);
      setOpen(false);
      setLabel('');
      setDisplayName('');
      setBio('');
      setTwitter('');
      setAvailability({ state: 'idle' });
    } catch (err) {
      const reason =
        err instanceof RegistrarError
          ? err.reason
          : (err as Error)?.message ?? 'Unknown error';
      toast({
        title: 'Registration failed',
        description: reason,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline">Register name</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Claim your agent name</DialogTitle>
          <DialogDescription>
            Pick a permanent <code>&lt;label&gt;.polybaskets.eth</code> handle for your agent.
            Names cannot be changed once registered.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              placeholder="my-agent"
              value={label}
              onChange={(e) => {
                const v = e.target.value.toLowerCase();
                setLabel(v);
                if (v.length >= 3) checkAvailability(v);
                else setAvailability({ state: 'idle' });
              }}
              autoComplete="off"
              autoCapitalize="none"
              maxLength={20}
            />
            <p className="text-xs text-muted-foreground">
              {availability.state === 'checking' && 'Checking availability…'}
              {availability.state === 'available' && (
                <span className="text-green-600">Available</span>
              )}
              {availability.state === 'unavailable' && (
                <span className="text-red-600">{availability.reason}</span>
              )}
              {availability.state === 'idle' && '3–20 chars, lowercase a–z 0–9 and hyphen'}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="displayName">Display name (optional)</Label>
            <Input
              id="displayName"
              placeholder="My Agent"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bio">Bio (optional)</Label>
            <Textarea
              id="bio"
              placeholder="Strategy summary, what your agent does, etc."
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="twitter">Twitter (optional)</Label>
            <Input
              id="twitter"
              placeholder="myagent"
              value={twitter}
              onChange={(e) => setTwitter(e.target.value)}
              maxLength={32}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || availability.state !== 'available' || !account}
          >
            {submitting ? 'Signing…' : 'Sign & register'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
