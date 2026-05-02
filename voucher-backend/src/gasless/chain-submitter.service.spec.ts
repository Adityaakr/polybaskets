import { ChainSubmitter } from './chain-submitter.service';

describe('ChainSubmitter (unit)', () => {
  // The real chain submitter is wired in onModuleInit which connects to a node.
  // Unit-test only the result-mapping logic by injecting a fake program directly.

  it('reports ok when sign-and-send finalizes successfully', async () => {
    const fakeProgram = {
      basketMarket: {
        registerAgent: jest.fn().mockReturnValue({
          withAccount: jest.fn().mockReturnThis(),
          calculateGas: jest.fn().mockResolvedValue(undefined),
          signAndSend: jest.fn().mockImplementation(async () => {
            return Promise.resolve({ msgId: '0xabc', txHash: '0x123', blockHash: '0xdef', response: () => Promise.resolve(undefined) });
          }),
        }),
      },
    };
    const submitter = new ChainSubmitter({ get: () => '' } as any);
    (submitter as any).program = fakeProgram;
    (submitter as any).account = { address: 'kGkXxx' };

    const result = await submitter.registerAgent('alice');
    expect(result.ok).toBe(true);
    expect(fakeProgram.basketMarket.registerAgent).toHaveBeenCalledWith('alice');
  });

  it('reports name_taken when response throws AgentNameTaken', async () => {
    const fakeProgram = {
      basketMarket: {
        registerAgent: jest.fn().mockReturnValue({
          withAccount: jest.fn().mockReturnThis(),
          calculateGas: jest.fn().mockResolvedValue(undefined),
          signAndSend: jest.fn().mockResolvedValue({
            msgId: '0xabc',
            txHash: '0x123',
            blockHash: '0xdef',
            response: () => Promise.reject(new Error('AgentNameTaken')),
          }),
        }),
      },
    };
    const submitter = new ChainSubmitter({ get: () => '' } as any);
    (submitter as any).program = fakeProgram;
    (submitter as any).account = { address: 'kGkXxx' };

    const result = await submitter.registerAgent('taken');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('name_taken');
    }
  });

  it('reports rejected on signAndSend error', async () => {
    const fakeProgram = {
      basketMarket: {
        registerAgent: jest.fn().mockReturnValue({
          withAccount: jest.fn().mockReturnThis(),
          calculateGas: jest.fn().mockResolvedValue(undefined),
          signAndSend: jest.fn().mockRejectedValue(new Error('node disconnected')),
        }),
      },
    };
    const submitter = new ChainSubmitter({ get: () => '' } as any);
    (submitter as any).program = fakeProgram;
    (submitter as any).account = { address: 'kGkXxx' };

    const result = await submitter.registerAgent('alice');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('rejected');
    }
  });
});
