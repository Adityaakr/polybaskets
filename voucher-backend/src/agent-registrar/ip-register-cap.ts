export type ReserveResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

export class IpRegisterCap {
  private state = new Map<string, { day: string; count: number }>();

  constructor(private readonly cap: number) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private secondsUntilUtcMidnight(): number {
    const now = new Date();
    const next = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      ),
    );
    return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
  }

  tryReserve(ip: string): ReserveResult {
    if (this.cap <= 0) return { ok: true };

    const today = this.today();
    const slot = this.state.get(ip);
    if (!slot || slot.day !== today) {
      this.state.set(ip, { day: today, count: 1 });
      return { ok: true };
    }
    if (slot.count >= this.cap) {
      return { ok: false, retryAfterSec: this.secondsUntilUtcMidnight() };
    }
    slot.count += 1;
    return { ok: true };
  }
}
