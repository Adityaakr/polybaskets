import { NameValidator } from './name.validator';

describe('NameValidator', () => {
  const v = new NameValidator();

  it.each([
    ['abc', true],
    ['a-b-c', true],
    ['agent01', true],
    ['a'.repeat(20), true],
  ])('accepts valid label %s', (label, expected) => {
    expect(v.isValid(label)).toBe(expected);
  });

  it.each([
    ['', 'too short'],
    ['ab', 'too short'],
    ['a'.repeat(21), 'too long'],
    ['-abc', 'invalid'],
    ['abc-', 'invalid'],
    ['Abc', 'invalid'],
    ['ab c', 'invalid'],
    ['ab_c', 'invalid'],
  ])('rejects %s with reason %s', (label, expected) => {
    expect(v.validate(label).reason).toBe(expected);
  });

  it.each(['admin', 'root', 'polybaskets', 'vara', 'namespace', 'system'])(
    'rejects blocked label %s',
    (label) => {
      expect(v.validate(label).reason).toBe('blocked');
    },
  );
});
