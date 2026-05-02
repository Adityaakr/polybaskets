import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/api';
import { hexToU8a } from '@polkadot/util';
import { waitReady } from '@polkadot/wasm-crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SailsProgram } from '../basket-market-client/lib';

const FINALIZATION_TIMEOUT_MS = 60_000;

export type RegisterChainResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'name_taken' | 'timeout' | 'rejected' | 'unknown';
      message?: string;
    };

@Injectable()
export class ChainSubmitter implements OnModuleInit {
  private readonly logger = new Logger(ChainSubmitter.name);
  private api!: GearApi;
  private nodeUrl!: string;
  private programId!: `0x${string}`;
  private account: any;
  private program!: SailsProgram;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.nodeUrl = this.config.get<string>('nodeUrl')!;
    this.programId = this.config.get<`0x${string}`>('basketMarketProgramId')!;
    this.api = new GearApi({ providerAddress: this.nodeUrl });
    await Promise.all([this.api.isReadyOrError, waitReady()]);

    const seed = this.config.get<string>('voucherAccount')!;
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 137 });
    if (seed.startsWith('0x')) {
      this.account = keyring.addFromSeed(hexToU8a(seed));
    } else if (seed.startsWith('//')) {
      this.account = keyring.addFromUri(seed);
    } else {
      this.account = keyring.addFromMnemonic(seed);
    }

    this.program = new SailsProgram(this.api, this.programId);
    this.logger.log(
      `ChainSubmitter ready: program ${this.programId} account ${this.account.address}`,
    );
  }

  async registerAgent(label: string): Promise<RegisterChainResult> {
    if (!this.program) {
      return { ok: false, reason: 'unknown', message: 'program not initialized' };
    }
    try {
      const tx = this.program.basketMarket
        .registerAgent(label)
        .withAccount(this.account);
      await tx.calculateGas();

      const sent = await Promise.race([
        tx.signAndSend(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('finalization_timeout')),
            FINALIZATION_TIMEOUT_MS,
          ),
        ),
      ]);

      try {
        await sent.response();
        return { ok: true };
      } catch (replyErr: any) {
        const message = replyErr?.message ?? String(replyErr);
        if (message.includes('AgentNameTaken')) {
          return { ok: false, reason: 'name_taken', message };
        }
        return { ok: false, reason: 'rejected', message };
      }
    } catch (err: any) {
      const message = err?.message ?? String(err);
      if (message === 'finalization_timeout') {
        return { ok: false, reason: 'timeout' };
      }
      this.logger.error(`registerAgent submit failed: ${message}`);
      return { ok: false, reason: 'rejected', message };
    }
  }
}
