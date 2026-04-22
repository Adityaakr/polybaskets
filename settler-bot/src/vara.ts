import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/api';
import { SailsProgram } from '../sails-client/lib.js';

// Types from generated client (global.d.ts) - types are available globally

export class VaraConnectionError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'VaraConnectionError';
    this.cause = cause;
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isRetryableVaraError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /disconnected|normal closure|abnormal closure|no response|websocket|connection closed|connection error|1000::|1006::/i.test(message);
}

export interface VaraBasket {
  id: number;
  creator: string;
  name: string;
  description: string;
  items: Array<{
    poly_market_id: string;
    poly_slug: string;
    weight_bps: number;
    selected_outcome: Outcome;
  }>;
  created_at: number;
  status: BasketStatus;
  asset_kind: BasketAssetKind;
}

export interface VaraSettlement {
  basket_id: number;
  proposer: string;
  item_resolutions: Array<ItemResolution>;
  payout_per_share: string;
  payload: string;
  proposed_at: number;
  challenge_deadline: number;
  finalized_at: number | null;
  status: SettlementStatus;
}

export class BasketMarketVaraClient {
  private api: GearApi | null = null;
  private program: SailsProgram | null = null;
  private settlerAccount: ReturnType<Keyring['addFromUri']> | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 10;
  private readonly reconnectDelay: number = 5000; // 5 seconds
  private reconnectPromise: Promise<void> | null = null;

  constructor(
    private readonly programId: string,
    private readonly rpcUrl: string,
    private readonly settlerSeed?: string
  ) {}

  async init(): Promise<void> {
    try {
      // Disconnect existing connection if any
      if (this.api) {
        try {
          await this.api.disconnect();
        } catch (e) {
          // Ignore disconnect errors
        }
      }

      this.api = await GearApi.create({ providerAddress: this.rpcUrl });
      this.program = new SailsProgram(this.api, this.programId as `0x${string}`);

      if (this.settlerSeed) {
        const keyring = new Keyring({ type: 'sr25519', ss58Format: 137 });
        this.settlerAccount = keyring.addFromUri(this.settlerSeed);
        console.log('Settler address:', this.settlerAccount.address);
      }

      // Set up connection event listeners
      this.setupConnectionListeners();

      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log(`BasketMarket Vara client initialized for program ${this.programId}`);
    } catch (error) {
      this.isConnected = false;
      throw error;
    }
  }

  private setupConnectionListeners(): void {
    if (!this.api) return;

    // GearApi uses provider events - check provider
    const provider = (this.api as any).provider;
    if (provider && typeof provider.on === 'function') {
      provider.on('disconnected', () => {
        console.warn('⚠️  WebSocket disconnected from Vara Network');
        this.isConnected = false;
      });

      provider.on('error', (error: Error) => {
        console.error('❌ WebSocket error:', error.message);
        this.isConnected = false;
      });

      provider.on('connected', () => {
        console.log('✅ WebSocket connected to Vara Network');
        this.isConnected = true;
        this.reconnectAttempts = 0;
      });
    }
  }

  async waitForReady(): Promise<void> {
    if (!this.api || !this.program || !this.isConnected) {
      await this.init();
    }
  }

  async ensureConnected(): Promise<void> {
    if (this.isConnected && this.api && this.program) {
      return;
    }

    if (this.reconnectPromise) {
      await this.reconnectPromise;
      return;
    }

    this.reconnectPromise = this.reconnect();
    try {
      await this.reconnectPromise;
    } finally {
      this.reconnectPromise = null;
    }
  }

  async forceReconnect(): Promise<void> {
    this.isConnected = false;
    await this.ensureConnected();
  }

  private async reconnect(): Promise<void> {
    // Try to reconnect
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`⚠️  Max reconnection attempts reached. Will reset and retry after ${this.reconnectDelay * 10 / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, this.reconnectDelay * 10));
      this.reconnectAttempts = 0; // Reset counter
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5); // Max 25 seconds
    console.log(`🔄 Reconnecting to Vara Network (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay/1000}s...`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.init();
      console.log('✅ Reconnected successfully');
      this.reconnectAttempts = 0; // Reset on successful connection
    } catch (error) {
      console.error(`❌ Reconnection attempt ${this.reconnectAttempts} failed:`, error);
      // Will retry on next call
      throw error;
    }
  }

  private async ctx() {
    await this.ensureConnected();
    if (!this.api || !this.program) {
      throw new Error('Vara client not initialized');
    }
    return { api: this.api, program: this.program };
  }

  private markDisconnected(error: unknown): VaraConnectionError {
    this.isConnected = false;
    return error instanceof VaraConnectionError
      ? error
      : new VaraConnectionError(getErrorMessage(error), error);
  }

  async getConfig(): Promise<{ adminRole: string; settlerRole: string; livenessMs: number; varaEnabled: boolean } | null> {
    try {
      const { program } = await this.ctx();
      const result = await program.basketMarket.getConfig().call();

      const toHex = (value: any) =>
        Array.isArray(value)
          ? '0x' + value.map((byte: number) => byte.toString(16).padStart(2, '0')).join('')
          : String(value);

      return {
        adminRole: toHex((result as BasketMarketConfig).admin_role),
        settlerRole: toHex((result as BasketMarketConfig).settler_role),
        livenessMs: Number((result as BasketMarketConfig).liveness_ms),
        varaEnabled: Boolean((result as BasketMarketConfig).vara_enabled),
      };
    } catch (error) {
      console.error('Error getting config:', error);
      if (isRetryableVaraError(error)) {
        throw this.markDisconnected(error);
      }
      return null;
    }
  }

  async getBasketCount(): Promise<number> {
    try {
      const { program } = await this.ctx();
      const count = await program.basketMarket.getBasketCount().call();
      return Number(count);
    } catch (error) {
      console.error('Error getting basket count:', error);
      if (isRetryableVaraError(error)) {
        throw this.markDisconnected(error);
      }
      throw error;
    }
  }

  async getBasket(basketId: number): Promise<VaraBasket | null> {
    try {
      const { program } = await this.ctx();
      const result = await program.basketMarket.getBasket(basketId).call();
      if ('err' in result) {
        return null;
      }
      const b = result.ok;
      // Convert ActorId to hex string
      const creatorHex = Array.isArray(b.creator)
        ? '0x' + b.creator.map((byte: number) => byte.toString(16).padStart(2, '0')).join('')
        : typeof b.creator === 'string'
          ? b.creator
          : String(b.creator);

      return {
        id: Number(b.id),
        creator: creatorHex,
        name: b.name,
        description: b.description,
        items: b.items.map(item => ({
          poly_market_id: item.poly_market_id,
          poly_slug: item.poly_slug,
          weight_bps: item.weight_bps,
          selected_outcome: item.selected_outcome,
        })),
        created_at: Number(b.created_at),
        status: b.status,
        asset_kind: b.asset_kind,
      };
    } catch (error) {
      console.error(`Error getting basket ${basketId}:`, error);
      if (isRetryableVaraError(error)) {
        throw this.markDisconnected(error);
      }
      throw error;
    }
  }

  async getSettlement(basketId: number): Promise<VaraSettlement | null> {
    try {
      const { program } = await this.ctx();
      const result = await program.basketMarket.getSettlement(basketId).call();
      if ('err' in result) {
        return null;
      }
      const s = result.ok;
      // Convert ActorId to hex string
      const proposerHex = Array.isArray(s.proposer)
        ? '0x' + s.proposer.map((byte: number) => byte.toString(16).padStart(2, '0')).join('')
        : typeof s.proposer === 'string'
          ? s.proposer
          : String(s.proposer);
      
      return {
        basket_id: Number(s.basket_id),
        proposer: proposerHex,
        item_resolutions: s.item_resolutions,
        payout_per_share: String(s.payout_per_share),
        payload: s.payload,
        proposed_at: Number(s.proposed_at),
        challenge_deadline: Number(s.challenge_deadline),
        finalized_at: s.finalized_at ? Number(s.finalized_at) : null,
        status: s.status,
      };
    } catch (error) {
      console.error(`Error getting settlement for basket ${basketId}:`, error);
      if (isRetryableVaraError(error)) {
        throw this.markDisconnected(error);
      }
      return null;
    }
  }

  async hasSettlement(basketId: number): Promise<boolean> {
    const settlement = await this.getSettlement(basketId);
    return settlement !== null;
  }

  async proposeSettlement(
    basketId: number,
    itemResolutions: Array<ItemResolution>,
    payload: string
  ): Promise<string | null> {
    try {
      const { program } = await this.ctx();
      if (!this.settlerAccount) {
        throw new Error('Settler account not configured');
      }

      const tx = program.basketMarket
        .proposeSettlement(basketId, itemResolutions, payload)
        .withAccount(this.settlerAccount);

      console.log(`[settler-bot] Basket ${basketId}: calculating gas for settlement proposal`);
      await tx.calculateGas();
      console.log(`[settler-bot] Basket ${basketId}: signing and sending settlement proposal`);
      const { txHash, response } = await tx.signAndSend();
      console.log(`[settler-bot] Basket ${basketId}: proposal tx submitted (${txHash}), waiting for response`);
      await response();
      
      return txHash;
    } catch (error) {
      console.error(`Error proposing settlement for basket ${basketId}:`, error);
      if (isRetryableVaraError(error)) {
        throw this.markDisconnected(error);
      }
      throw error;
    }
  }

  async finalizeSettlement(basketId: number): Promise<string | null> {
    try {
      const { program } = await this.ctx();
      if (!this.settlerAccount) {
        throw new Error('Settler account not configured');
      }

      const tx = program.basketMarket
        .finalizeSettlement(basketId)
        .withAccount(this.settlerAccount);

      console.log(`[settler-bot] Basket ${basketId}: calculating gas for settlement finalization`);
      await tx.calculateGas();
      console.log(`[settler-bot] Basket ${basketId}: signing and sending settlement finalization`);
      const { txHash, response } = await tx.signAndSend();
      console.log(`[settler-bot] Basket ${basketId}: finalization tx submitted (${txHash}), waiting for response`);
      await response();
      
      return txHash;
    } catch (error) {
      console.error(`Error finalizing settlement for basket ${basketId}:`, error);
      if (isRetryableVaraError(error)) {
        throw this.markDisconnected(error);
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    if (this.api) {
      const api = this.api;
      this.api = null;
      this.program = null;
      await api.disconnect();
    }
  }
}
