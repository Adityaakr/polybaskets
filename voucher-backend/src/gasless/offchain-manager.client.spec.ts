import { ConfigService } from '@nestjs/config';
import { OffchainManagerClient } from './offchain-manager.client';

jest.mock('@thenamespace/offchain-manager', () => {
  const fakeClient = {
    createSubname: jest.fn().mockResolvedValue(undefined),
    updateSubname: jest.fn().mockResolvedValue(undefined),
    isSubnameAvailable: jest.fn().mockResolvedValue({ isAvailable: true }),
    getSingleSubname: jest.fn().mockResolvedValue(null),
    getFilteredSubnames: jest.fn().mockResolvedValue({ items: [], totalItems: 0, page: 1, size: 50 }),
  };
  return {
    createOffchainClient: jest.fn(() => fakeClient),
    ChainName: { Vara: 'vara' },
  };
});

describe('OffchainManagerClient', () => {
  let client: OffchainManagerClient;
  let config: ConfigService;

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        const map: Record<string, any> = {
          'namespace.apiKey': 'test-key',
          'namespace.mode': 'mainnet',
          'namespace.parentName': 'polybaskets.eth',
          'namespace.ownerEvm': '0x0000000000000000000000000000000000000001',
        };
        return map[key];
      }),
    } as any;
    client = new OffchainManagerClient(config);
    client.onModuleInit();
  });

  it('createForAgent passes the right shape', async () => {
    const sdk = require('@thenamespace/offchain-manager').createOffchainClient.mock
      .results[0].value;
    await client.createForAgent({
      label: 'alice',
      ss58: 'kGkAlice',
      texts: { name: 'Alice' },
      metadata: { agentType: 'human' },
    });
    expect(sdk.createSubname).toHaveBeenCalledWith({
      label: 'alice',
      parentName: 'polybaskets.eth',
      owner: '0x0000000000000000000000000000000000000001',
      addresses: [{ chain: 'vara', value: 'kGkAlice' }],
      texts: [{ key: 'name', value: 'Alice' }],
      metadata: [
        { key: 'varaAddress', value: 'kGkAlice' },
        { key: 'agentType', value: 'human' },
      ],
    });
  });

  it('reverseLookup returns first match', async () => {
    const sdk = require('@thenamespace/offchain-manager').createOffchainClient.mock
      .results[0].value;
    sdk.getFilteredSubnames.mockResolvedValueOnce({
      items: [{ fullName: 'alice.polybaskets.eth', label: 'alice' }],
      totalItems: 1, page: 1, size: 1,
    });
    const result = await client.reverseLookup('kGkAlice');
    expect(result?.label).toBe('alice');
    expect(sdk.getFilteredSubnames).toHaveBeenCalledWith({
      parentName: 'polybaskets.eth',
      metadata: { varaAddress: 'kGkAlice' },
      size: 1,
    });
  });
});
