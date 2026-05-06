import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChainName,
  createOffchainClient,
  OffchainClient,
} from '@thenamespace/offchain-manager';

// Symbol-keyed property so JSON.stringify (which only enumerates string keys)
// cannot leak the underlying SDK client or any credentials it holds.
const SDK = Symbol('sdk');

export type Address = { chain: string; value: string };
export type Texts = Record<string, string | null>;

export type CreateSubnameInput = {
  label: string;
  texts: Texts;
  addresses: Address[];
  varaAddress: string;
};

export type SetRecordsInput = {
  fullName: string;
  texts: Texts;
  addresses: Address[];
};

export type SubnameSummary = {
  fullName: string;
  label: string;
  varaAddressMetadata: string | null;
  texts: Record<string, string>;
  addresses: Address[];
};

@Injectable()
export class OffchainManagerClient implements OnModuleInit {
  private readonly logger = new Logger(OffchainManagerClient.name);

  // Never exposed publicly. Symbol-keyed so JSON.stringify cannot reach it.
  private readonly [SDK]: OffchainClient;

  public readonly parentName: string;
  public readonly ownerEvm: string;

  constructor(private readonly configService: ConfigService) {
    const mode = configService.get<'mainnet' | 'sepolia'>(
      'agentRegistrar.namespaceMode',
    );
    const apiKey = configService.get<string>('agentRegistrar.namespaceApiKey');
    this.parentName = configService.get<string>('agentRegistrar.parentName');
    this.ownerEvm = configService.get<string>('agentRegistrar.ownerEvm');

    this[SDK] = createOffchainClient({ mode, defaultApiKey: apiKey });
  }

  onModuleInit(): void {
    this.logger.log(
      `OffchainManagerClient ready: parent=${this.parentName} owner=${this.ownerEvm}`,
    );
  }

  async isAvailable(fullName: string): Promise<boolean> {
    const r = await this[SDK].isSubnameAvailable(fullName);
    return r.isAvailable;
  }

  /**
   * Find a subname by Vara address stored in metadata.
   *
   * Note: relies on the SDK's metadata-filter support in QuerySubnamesRequest.
   * If a future SDK version drops this field, the query will fall back to
   * returning all subnames under the parent, and the service layer will need
   * to post-filter client-side.
   */
  async findByVaraAddress(varaAddress: string): Promise<SubnameSummary | null> {
    const page = await this[SDK].getFilteredSubnames({
      parentName: this.parentName,
      metadata: { varaAddress },
      page: 1,
      size: 1,
    });
    const hit = page.items[0];
    if (!hit) return null;
    return this.toSummary(hit);
  }

  async getByLabel(label: string): Promise<SubnameSummary | null> {
    const page = await this[SDK].getFilteredSubnames({
      parentName: this.parentName,
      labelSearch: label,
      page: 1,
      size: 1,
    });
    const hit = page.items[0];
    if (!hit) return null;
    return this.toSummary(hit);
  }

  async create(input: CreateSubnameInput): Promise<string> {
    const fullName = `${input.label}.${this.parentName}`;

    await this[SDK].createSubname({
      label: input.label,
      parentName: this.parentName,
      owner: this.ownerEvm,
      addresses: input.addresses.map((a) => ({
        chain: this.toChainName(a.chain),
        value: a.value,
      })),
      texts: Object.entries(input.texts)
        .filter(([, v]) => v !== null)
        .map(([key, value]) => ({ key, value: value as string })),
      metadata: [{ key: 'varaAddress', value: input.varaAddress }],
    });

    return fullName;
  }

  /**
   * Update text and address records on an existing subname.
   * Uses updateSubname under the hood — the SDK has no setRecords method.
   * Null text values are sent as empty strings, which the Namespace API
   * interprets as a delete instruction.
   */
  async setRecords(input: SetRecordsInput): Promise<void> {
    await this[SDK].updateSubname(input.fullName, {
      addresses: input.addresses.map((a) => ({
        chain: this.toChainName(a.chain),
        value: a.value,
      })),
      texts: Object.entries(input.texts).map(([key, value]) => ({
        key,
        // Empty string signals deletion per Namespace SDK convention.
        value: value === null ? '' : value,
      })),
    });
  }

  private toChainName(chain: string): ChainName {
    // ChainName is a TypeScript enum whose values are lowercase strings
    // (e.g., ChainName.Ethereum = "eth"). We accept both the enum key
    // ("Ethereum") and the enum value ("eth") for convenience.
    const byKey = (ChainName as unknown as Record<string, ChainName>)[chain];
    if (byKey !== undefined) return byKey;

    const byValue = Object.values(ChainName).find((v) => v === chain);
    if (byValue !== undefined) return byValue as ChainName;

    throw new Error(`unsupported chain "${chain}"`);
  }

  private toSummary(hit: {
    fullName: string;
    label: string;
    texts: Record<string, string>;
    addresses: Record<string, string>;
    metadata: Record<string, string>;
  }): SubnameSummary {
    // The SDK returns addresses as a coin-type → address map.
    // We expose them as { chain, value } pairs using the coin-type key as chain.
    const addresses: Address[] = Object.entries(hit.addresses ?? {}).map(
      ([chain, value]) => ({ chain, value }),
    );

    return {
      fullName: hit.fullName,
      label: hit.label,
      varaAddressMetadata: (hit.metadata ?? {})['varaAddress'] ?? null,
      texts: hit.texts ?? {},
      addresses,
    };
  }

  toJSON(): Record<string, unknown> {
    return { parentName: this.parentName, ownerEvm: this.ownerEvm };
  }

  toString(): string {
    return `OffchainManagerClient(parent=${this.parentName})`;
  }
}
