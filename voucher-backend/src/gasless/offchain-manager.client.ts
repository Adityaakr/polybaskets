import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChainName,
  createOffchainClient,
} from '@thenamespace/offchain-manager';

type SDKClient = ReturnType<typeof createOffchainClient>;

export interface CreateForAgentInput {
  label: string;
  ss58: string;
  texts?: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface UpdateForAgentInput {
  label: string;
  texts?: Record<string, string>;
  metadata?: Record<string, string>;
}

@Injectable()
export class OffchainManagerClient implements OnModuleInit {
  private sdk!: SDKClient;
  private parentName!: string;
  private ownerEvm!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const apiKey = this.config.get<string>('namespace.apiKey');
    const mode = this.config.get<'mainnet' | 'sepolia'>('namespace.mode');
    this.parentName = this.config.get<string>('namespace.parentName')!;
    this.ownerEvm = this.config.get<string>('namespace.ownerEvm')!;
    if (!apiKey) throw new Error('NAMESPACE_API_KEY is not configured');
    this.sdk = createOffchainClient({ mode, defaultApiKey: apiKey });
  }

  private kvList(rec?: Record<string, string>): { key: string; value: string }[] {
    if (!rec) return [];
    return Object.entries(rec).map(([key, value]) => ({ key, value }));
  }

  async createForAgent(input: CreateForAgentInput): Promise<void> {
    await this.sdk.createSubname({
      label: input.label,
      parentName: this.parentName,
      owner: this.ownerEvm,
      addresses: [{ chain: ChainName.Vara, value: input.ss58 }],
      texts: this.kvList(input.texts),
      metadata: [
        { key: 'varaAddress', value: input.ss58 },
        ...this.kvList(input.metadata),
      ],
    });
  }

  async updateForAgent(input: UpdateForAgentInput): Promise<void> {
    await this.sdk.updateSubname(`${input.label}.${this.parentName}`, {
      texts: this.kvList(input.texts),
      metadata: this.kvList(input.metadata),
    });
  }

  async isAvailable(label: string): Promise<boolean> {
    const { isAvailable } = await this.sdk.isSubnameAvailable(
      `${label}.${this.parentName}`,
    );
    return isAvailable;
  }

  async forwardLookup(label: string) {
    return this.sdk.getSingleSubname(`${label}.${this.parentName}`);
  }

  async reverseLookup(ss58: string) {
    const page = await this.sdk.getFilteredSubnames({
      parentName: this.parentName,
      metadata: { varaAddress: ss58 },
      size: 1,
    });
    return page.items[0] ?? null;
  }
}
