import { VaraAgentReader, AgentInfo } from './vara-agent.reader';

describe('VaraAgentReader (decoding)', () => {
  it('normalizes registered_at + name_updated_at to bigint', () => {
    const raw = {
      address: '0x' + 'aa'.repeat(32),
      name: 'happy',
      registered_at: '12345',
      name_updated_at: 12346,
    };
    const decoded: AgentInfo = VaraAgentReader.normalizeAgent(raw);
    expect(decoded.address).toBe('0x' + 'aa'.repeat(32));
    expect(decoded.name).toBe('happy');
    expect(decoded.registered_at).toBe(12345n);
    expect(decoded.name_updated_at).toBe(12346n);
  });

  it('returns null when the on-chain Option is None', () => {
    expect(VaraAgentReader.normalizeAgentOption(null)).toBeNull();
    expect(VaraAgentReader.normalizeAgentOption(undefined)).toBeNull();
  });

  it('returns the decoded agent when Option is Some', () => {
    const raw = { address: '0xabc', name: 'a', registered_at: 1, name_updated_at: 2 };
    const decoded = VaraAgentReader.normalizeAgentOption(raw)!;
    expect(decoded.name).toBe('a');
    expect(decoded.registered_at).toBe(1n);
  });
});
