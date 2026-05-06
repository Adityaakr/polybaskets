import { isNameAllowed, RESERVED_NAMES } from './name-rules';

describe('name-rules', () => {
  it('accepts valid names', () => {
    expect(isNameAllowed('happy')).toBe(true);
    expect(isNameAllowed('happy-bot')).toBe(true);
    expect(isNameAllowed('a1b2-c3')).toBe(true);
  });

  it('rejects reserved names', () => {
    for (const r of RESERVED_NAMES) {
      expect(isNameAllowed(r)).toBe(false);
    }
  });

  it('rejects bad chars', () => {
    expect(isNameAllowed('Happy')).toBe(false);
    expect(isNameAllowed('hi!')).toBe(false);
    expect(isNameAllowed('-leading')).toBe(false);
    expect(isNameAllowed('trailing-')).toBe(false);
  });

  it('rejects bad length', () => {
    expect(isNameAllowed('ab')).toBe(false);
    expect(isNameAllowed('a'.repeat(21))).toBe(false);
  });
});
