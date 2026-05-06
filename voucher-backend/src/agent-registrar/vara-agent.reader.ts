import { GearApi, decodeAddress } from '@gear-js/api';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BasketMarketProgram, AgentInfoRaw } from './basket-market-program';

export type AgentInfo = {
  address: `0x${string}`;
  name: string;
  registered_at: bigint;
  name_updated_at: bigint;
};

@Injectable()
export class VaraAgentReader implements OnModuleInit {
  private readonly logger = new Logger('VaraAgentReader');
  private api: GearApi;
  private readonly nodeUrl: string;
  private readonly programId: `0x${string}`;

  constructor(private readonly configService: ConfigService) {
    this.nodeUrl = configService.get<string>('nodeUrl');
    this.programId = configService.get<string>(
      'agentRegistrar.basketMarketProgramId',
    ) as `0x${string}`;
    this.api = new GearApi({ providerAddress: this.nodeUrl });
  }

  async onModuleInit(): Promise<void> {
    await this.api.isReadyOrError;
    this.logger.log(
      `VaraAgentReader connected to ${this.nodeUrl}, program=${this.programId}`,
    );
  }

  // -------------------------------------------------------------------------
  // Static decoders — test-pinned, no RPC dependency
  // -------------------------------------------------------------------------

  static normalizeAgent(raw: AgentInfoRaw): AgentInfo {
    return {
      address: raw.address as `0x${string}`,
      name: raw.name,
      registered_at: BigInt(raw.registered_at as never),
      name_updated_at: BigInt(raw.name_updated_at as never),
    };
  }

  static normalizeAgentOption(
    raw: AgentInfoRaw | null | undefined,
  ): AgentInfo | null {
    if (raw === null || raw === undefined) return null;
    return VaraAgentReader.normalizeAgent(raw);
  }

  // -------------------------------------------------------------------------
  // Live RPC methods
  // -------------------------------------------------------------------------

  async getAgent(accountSs58: string): Promise<AgentInfo | null> {
    await this.ensureConnected();
    const program = new BasketMarketProgram(this.api, this.programId);
    const accountHex = decodeAddress(accountSs58);
    const result = await program.basketMarket.getAgent(accountHex as never).call();
    return VaraAgentReader.normalizeAgentOption(result as AgentInfoRaw | null);
  }

  async getAllAgents(): Promise<AgentInfo[]> {
    await this.ensureConnected();
    const program = new BasketMarketProgram(this.api, this.programId);
    const list = await program.basketMarket.getAllAgents().call();
    return (list as AgentInfoRaw[]).map((a) => VaraAgentReader.normalizeAgent(a));
  }

  // -------------------------------------------------------------------------
  // Reconnect helper — mirrors voucher.service.ts pattern
  // -------------------------------------------------------------------------

  private async ensureConnected(): Promise<GearApi> {
    if (this.api.isConnected) return this.api;
    return this.reconnectApi();
  }

  private async reconnectApi(): Promise<GearApi> {
    this.logger.warn('VaraAgentReader: GearApi disconnected — reconnecting...');
    try {
      await this.api.disconnect();
    } catch {
      // old socket may already be dead
    }
    this.api = new GearApi({ providerAddress: this.nodeUrl });
    await this.api.isReadyOrError;
    this.logger.log('VaraAgentReader: GearApi reconnected');
    return this.api;
  }
}
