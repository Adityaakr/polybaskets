import { IpRegisterCap } from './ip-register-cap';

describe('IpRegisterCap', () => {
  let cap: IpRegisterCap;

  beforeEach(() => {
    cap = new IpRegisterCap(3);
  });

  it('allows up to the cap and rejects after', () => {
    expect(cap.tryReserve('1.1.1.1').ok).toBe(true);
    expect(cap.tryReserve('1.1.1.1').ok).toBe(true);
    expect(cap.tryReserve('1.1.1.1').ok).toBe(true);
    const denied = cap.tryReserve('1.1.1.1');
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it('isolates IPs from each other', () => {
    for (let i = 0; i < 3; i++) cap.tryReserve('a');
    expect(cap.tryReserve('b').ok).toBe(true);
  });

  it('disabled when cap <= 0', () => {
    const open = new IpRegisterCap(0);
    for (let i = 0; i < 100; i++) {
      expect(open.tryReserve('z').ok).toBe(true);
    }
  });
});
