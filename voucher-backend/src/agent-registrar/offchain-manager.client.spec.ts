import { ConfigService } from '@nestjs/config';
import { OffchainManagerClient } from './offchain-manager.client';

jest.mock('@thenamespace/offchain-manager', () => {
  return {
    createOffchainClient: jest.fn(() => ({
      isSubnameAvailable: jest.fn(async () => ({ isAvailable: true })),
      createSubname: jest.fn(async () => ({ fullName: 'happy.polybaskets.eth' })),
      setRecords: jest.fn(async () => undefined),
      getFilteredSubnames: jest.fn(async () => ({ items: [] })),
    })),
    ChainName: { Ethereum: 'Ethereum' },
  };
});

function makeConfig(): ConfigService {
  return {
    get: (key: string) => {
      const map: Record<string, unknown> = {
        'agentRegistrar.namespaceApiKey': 'ns-test',
        'agentRegistrar.namespaceMode': 'sepolia',
        'agentRegistrar.parentName': 'polybaskets.eth',
        'agentRegistrar.ownerEvm': '0xowner',
      };
      return map[key];
    },
  } as unknown as ConfigService;
}

describe('OffchainManagerClient', () => {
  it('initializes with mode + parent + owner from config', () => {
    const c = new OffchainManagerClient(makeConfig());
    expect(c.parentName).toBe('polybaskets.eth');
    expect(c.ownerEvm).toBe('0xowner');
  });

  it('does not echo the API key in toString or JSON', () => {
    const c = new OffchainManagerClient(makeConfig());
    expect(JSON.stringify(c)).not.toContain('ns-test');
    expect(String(c)).not.toContain('ns-test');
  });

  it('isAvailable proxies through the SDK', async () => {
    const c = new OffchainManagerClient(makeConfig());
    expect(await c.isAvailable('happy.polybaskets.eth')).toBe(true);
  });
});
