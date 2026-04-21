import {
  GearApi,
  HexString,
  IUpdateVoucherParams,
  VoucherIssuedData,
} from '@gear-js/api';
import { waitReady } from '@polkadot/wasm-crypto';
import { hexToU8a } from '@polkadot/util';
import { Keyring } from '@polkadot/api';
import { Repository } from 'typeorm';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Voucher } from '../entities/voucher.entity';

const SECONDS_PER_BLOCK = 3;
const PLANCK_PER_VARA = BigInt(1e12);
const MIN_RESERVE_VARA = 10n;
const SIGN_AND_SEND_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), SIGN_AND_SEND_TIMEOUT_MS),
    ),
  ]);
}

@Injectable()
export class VoucherService implements OnModuleInit {
  private logger = new Logger('VoucherService');
  private api: GearApi;
  private nodeUrl: string;
  public account;

  constructor(
    @InjectRepository(Voucher) private readonly repo: Repository<Voucher>,
    private readonly configService: ConfigService,
  ) {
    this.nodeUrl = configService.get('nodeUrl');
    this.api = new GearApi({ providerAddress: this.nodeUrl });
  }

  /**
   * Ensures the GearApi WebSocket is connected. If the connection dropped
   * (node restart, network glitch), creates a fresh instance and awaits ready.
   * Call this before every chain operation.
   */
  private async ensureConnected(): Promise<GearApi> {
    if (this.api.isConnected) return this.api;

    this.logger.warn('GearApi disconnected — reconnecting...');
    try {
      await this.api.disconnect();
    } catch {
      // old socket may already be dead
    }
    this.api = new GearApi({ providerAddress: this.nodeUrl });
    await this.api.isReadyOrError;
    this.logger.log('GearApi reconnected');
    return this.api;
  }

  getAccountBalance() {
    return this.api.balance.findOut(this.account.address);
  }

  async onModuleInit() {
    // Re-throw on failure — silent startup with a broken API is worse than a crash loop
    await Promise.all([this.api.isReadyOrError, waitReady()]);

    const keyring = new Keyring({ type: 'sr25519', ss58Format: 137 });
    const seed = this.configService.get('voucherAccount');

    if (seed.startsWith('0x')) {
      this.account = keyring.addFromSeed(hexToU8a(seed));
    } else if (seed.startsWith('//')) {
      this.account = keyring.addFromUri(seed);
    } else {
      this.account = keyring.addFromMnemonic(seed);
    }

    this.logger.log(`Voucher issuer: ${this.account.address}`);
  }

  async issue(
    account: HexString,
    programId: HexString,
    amount: number,
    durationInSec: number,
  ): Promise<string> {
    await this.ensureConnected();
    const durationInBlocks = Math.round(durationInSec / SECONDS_PER_BLOCK);

    const issuerBalance = (await this.getAccountBalance()).toBigInt();
    if (issuerBalance < BigInt(amount) * PLANCK_PER_VARA + MIN_RESERVE_VARA * PLANCK_PER_VARA) {
      throw new Error(
        `Insufficient issuer balance (${issuerBalance / PLANCK_PER_VARA} VARA). Min reserve: ${MIN_RESERVE_VARA} VARA.`,
      );
    }

    this.logger.log(
      `Issuing voucher: account=${account} amount=${amount} VARA duration=${durationInSec}s program=${programId}`,
    );

    const { extrinsic } = await this.api.voucher.issue(
      account,
      BigInt(amount) * PLANCK_PER_VARA,
      durationInBlocks,
      [programId],
    );

    const [voucherId, blockHash] = await withTimeout(
      new Promise<[HexString, HexString]>((resolve, reject) => {
        extrinsic.signAndSend(this.account, ({ events, status }) => {
          if (status.isDropped || status.isInvalid || status.isUsurped) {
            return reject(new Error(`Transaction ${status.type} — not included in block`));
          }
          if (status.isInBlock) {
            const viEvent = events.find(
              ({ event }) => event.method === 'VoucherIssued',
            );
            if (viEvent) {
              const data = viEvent.event.data as VoucherIssuedData;
              resolve([data.voucherId.toHex(), status.asInBlock.toHex()]);
            } else {
              const efEvent = events.find(
                ({ event }) => event.method === 'ExtrinsicFailed',
              );
              reject(
                efEvent
                  ? this.api.getExtrinsicFailedError(efEvent?.event)
                  : new Error('VoucherIssued event not found'),
              );
            }
          }
        }).catch(reject);
      }),
      'signAndSend timed out after 60s — transaction may or may not have landed',
    );

    const blockNumber = (
      await this.api.blocks.getBlockNumber(blockHash)
    ).toNumber();
    const validUpToBlock = BigInt(blockNumber + durationInBlocks);
    const validUpTo = new Date(Date.now() + durationInSec * 1000);
    const now = new Date();

    this.logger.log(`Voucher issued: ${voucherId} valid until ${validUpTo.toISOString()}`);

    await this.repo.save(
      new Voucher({
        account,
        voucherId,
        validUpToBlock,
        validUpTo,
        programs: [programId],
        varaToIssue: amount,
        lastRenewedAt: now,
        revoked: false,
      }),
    );

    return voucherId;
  }

  async update(
    voucher: Voucher,
    balance: number,
    prolongDurationInSec?: number,
    addPrograms?: HexString[],
  ) {
    if (voucher.revoked) {
      throw new Error(`Cannot update revoked voucher ${voucher.voucherId} — issue a new one instead`);
    }

    await this.ensureConnected();
    const voucherBalance =
      (await this.api.balance.findOut(voucher.voucherId)).toBigInt() /
      PLANCK_PER_VARA;
    const durationInBlocks = Math.round(prolongDurationInSec / SECONDS_PER_BLOCK);
    const topUp = BigInt(balance) - voucherBalance;

    const params: IUpdateVoucherParams = {};
    if (prolongDurationInSec) params.prolongDuration = durationInBlocks;
    if (addPrograms) {
      params.appendPrograms = addPrograms;
      voucher.programs.push(...addPrograms);
    }
    if (topUp > 0) params.balanceTopUp = topUp * PLANCK_PER_VARA;

    this.logger.log(`Updating voucher: ${voucher.voucherId} for ${voucher.account}`);

    const tx = this.api.voucher.update(voucher.account, voucher.voucherId, params);

    const blockHash = await withTimeout(
      new Promise<HexString>((resolve, reject) => {
        tx.signAndSend(this.account, ({ events, status }) => {
          if (status.isDropped || status.isInvalid || status.isUsurped) {
            return reject(new Error(`Transaction ${status.type} — not included in block`));
          }
          if (status.isInBlock) {
            const vuEvent = events.find(({ event }) => event.method === 'VoucherUpdated');
            if (vuEvent) {
              resolve(status.asInBlock.toHex());
            } else {
              const efEvent = events.find(({ event }) => event.method === 'ExtrinsicFailed');
              reject(
                efEvent
                  ? JSON.stringify(this.api.getExtrinsicFailedError(efEvent?.event))
                  : new Error('VoucherUpdated event not found'),
              );
            }
          }
        }).catch(reject);
      }),
      'signAndSend timed out after 60s',
    );

    const now = new Date();
    if (durationInBlocks) {
      const blockNumber = (await this.api.blocks.getBlockNumber(blockHash)).toNumber();
      voucher.validUpToBlock = BigInt(blockNumber + durationInBlocks);
      voucher.validUpTo = new Date(Date.now() + prolongDurationInSec * 1000);
    }
    voucher.lastRenewedAt = now;

    this.logger.log(`Voucher updated: ${voucher.voucherId} valid until ${voucher.validUpTo.toISOString()}`);
    await this.repo.save(voucher);
  }

  async revoke(voucher: Voucher) {
    await this.ensureConnected();
    const tx = this.api.voucher.revoke(voucher.account, voucher.voucherId);
    try {
      await withTimeout(
        new Promise<HexString>((resolve, reject) => {
          tx.signAndSend(this.account, ({ events, status }) => {
            if (status.isDropped || status.isInvalid || status.isUsurped) {
              return reject(new Error(`Transaction ${status.type}`));
            }
            if (status.isInBlock) {
              const vrEvent = events.find(({ event }) => event.method === 'VoucherRevoked');
              if (vrEvent) resolve(status.asInBlock.toHex());
              else {
                const efEvent = events.find(({ event }) => event.method === 'ExtrinsicFailed');
                reject(
                  efEvent
                    ? JSON.stringify(this.api.getExtrinsicFailedError(efEvent?.event))
                    : new Error('VoucherRevoked event not found'),
                );
              }
            }
          }).catch(reject);
        }),
        'revoke signAndSend timed out after 60s',
      );
    } catch (e) {
      this.logger.error(
        `On-chain revoke failed for ${voucher.voucherId} — marking DB as revoked to stop retries`,
        e,
      );
    }
    voucher.revoked = true;
    await this.repo.save(voucher);
  }

  async getVoucher(account: string): Promise<Voucher | null> {
    return this.repo.findOneBy({ account, revoked: false });
  }

  /**
   * Reads the on-chain balance of a voucher ID.
   * Used by the public GET /voucher/:account endpoint so agents can detect
   * drained vouchers mid-session and decide whether to stop or ask for help.
   */
  async getVoucherBalance(voucherId: string): Promise<bigint> {
    await this.ensureConnected();
    return (await this.api.balance.findOut(voucherId)).toBigInt();
  }

  /**
   * Appends a program to an existing voucher without funding it.
   * Path B: once a voucher is funded for the UTC day, subsequent same-day
   * POSTs for additional programs only append the program — no balance delta,
   * no cap charge, no lastRenewedAt update.
   */
  async appendProgramOnly(voucher: Voucher, program: HexString): Promise<void> {
    if (voucher.revoked) {
      throw new Error(
        `Cannot append to revoked voucher ${voucher.voucherId} — issue a new one instead`,
      );
    }

    await this.ensureConnected();

    const tx = this.api.voucher.update(voucher.account, voucher.voucherId, {
      appendPrograms: [program],
    });

    await withTimeout(
      new Promise<HexString>((resolve, reject) => {
        tx.signAndSend(this.account, ({ events, status }) => {
          if (status.isDropped || status.isInvalid || status.isUsurped) {
            return reject(new Error(`Transaction ${status.type} — not included in block`));
          }
          if (status.isInBlock) {
            const vuEvent = events.find(({ event }) => event.method === 'VoucherUpdated');
            if (vuEvent) {
              resolve(status.asInBlock.toHex());
            } else {
              const efEvent = events.find(({ event }) => event.method === 'ExtrinsicFailed');
              reject(
                efEvent
                  ? JSON.stringify(this.api.getExtrinsicFailedError(efEvent?.event))
                  : new Error('VoucherUpdated event not found'),
              );
            }
          }
        }).catch(reject);
      }),
      'appendProgramOnly signAndSend timed out after 60s',
    );

    voucher.programs.push(program);
    // Intentionally NOT touching lastRenewedAt — this is not a funding event.
    this.logger.log(`Voucher program appended: ${voucher.voucherId} += ${program}`);
    await this.repo.save(voucher);
  }
}
