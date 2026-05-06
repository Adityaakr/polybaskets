import { ConfigService } from '@nestjs/config';
import { AgentReconciler } from './agent-reconciler';
import type { AgentInfo } from './vara-agent.reader';
import type { OffchainManagerClient } from './offchain-manager.client';
import type { VaraAgentReader } from './vara-agent.reader';

const HEX = (x: string) => ('0x' + x.repeat(32)) as `0x${string}`;
const A: AgentInfo = { address: HEX('a'), name: 'alpha', registered_at: 1n, name_updated_at: 1n };
const B: AgentInfo = { address: HEX('b'), name: 'beta', registered_at: 2n, name_updated_at: 2n };

function build(): { rec: AgentReconciler; client: any; reader: any } {
  const reader: any = {
    getAllAgents: jest.fn(async () => [A, B]),
    getAgent: jest.fn(async () => null),
  };
  const client: any = {
    parentName: 'polybaskets.eth',
    ownerEvm: '0xowner',
    findByVaraAddress: jest.fn(async (addr: string) =>
      addr === A.address
        ? { fullName: 'alpha.polybaskets.eth', label: 'alpha', varaAddressMetadata: A.address, texts: {}, addresses: [] }
        : null,
    ),
    isAvailable: jest.fn(async () => true),
    create: jest.fn(async () => 'beta.polybaskets.eth'),
    setRecords: jest.fn(),
  };
  const cfg: any = { get: () => false };
  const rec = new AgentReconciler(reader as VaraAgentReader, client as OffchainManagerClient, cfg as ConfigService);
  return { rec, client, reader };
}

describe('AgentReconciler', () => {
  it('creates only the missing subname', async () => {
    const { rec, client } = build();
    const summary = await rec.reconcileAgents([A, B]);
    expect(summary).toEqual({ total: 2, created: 1, skipped: 1, failed: 0 });
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it('continues on per-agent failures', async () => {
    const { rec, client } = build();
    (client.create as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const summary = await rec.reconcileAgents([A, B]);
    expect(summary.failed).toBe(1);
    expect(summary.created).toBe(0);
  });

  it('runMigration is a no-op when MIGRATION_ENABLED is false', async () => {
    const { rec, reader } = build();
    await rec.runMigration();
    expect(reader.getAllAgents).not.toHaveBeenCalled();
  });
});
