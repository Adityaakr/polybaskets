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

@Injectable()
export class VoucherService implements OnModuleInit {
  private logger = new Logger('VoucherService');
  private api: GearApi;
  public account;

  constructor(
    @InjectRepository(Voucher) private readonly repo: Repository<Voucher>,
    private readonly configService: ConfigService,
  ) {
    this.api = new GearApi({
      providerAddress: configService.get('nodeUrl'),
    });
  }

  getAccountBalance() {
    return this.api.balance.findOut(this.account.address);
  }

  async onModuleInit() {
    await Promise.all([this.api.isReadyOrError, waitReady()]).catch((e) => {
      this.logger.error('VoucherService.onModuleInit', e);
    });

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
    const durationInBlocks = Math.round(durationInSec / SECONDS_PER_BLOCK);

    this.logger.log(
      `Issuing voucher: account=${account} amount=${amount} VARA duration=${durationInSec}s program=${programId}`,
    );

    const { extrinsic } = await this.api.voucher.issue(
      account,
      amount * 1e12,
      durationInBlocks,
      [programId],
    );

    const [voucherId, blockHash] = await new Promise<[HexString, HexString]>(
      (resolve, reject) => {
        extrinsic.signAndSend(this.account, ({ events, status }) => {
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
                  : 'VoucherIssued event not found',
              );
            }
          }
        });
      },
    );

    const blockNumber = (
      await this.api.blocks.getBlockNumber(blockHash)
    ).toNumber();
    const validUpToBlock = BigInt(blockNumber + durationInBlocks);
    const validUpTo = new Date(Date.now() + durationInSec * 1000);

    this.logger.log(`Voucher issued: ${voucherId} valid until ${validUpTo.toISOString()}`);

    await this.repo.save(
      new Voucher({
        account,
        voucherId,
        validUpToBlock,
        validUpTo,
        programs: [programId],
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
    const voucherBalance =
      (await this.api.balance.findOut(voucher.voucherId)).toBigInt() /
      BigInt(1e12);
    const durationInBlocks = Math.round(prolongDurationInSec / SECONDS_PER_BLOCK);
    const topUp = BigInt(balance) - voucherBalance;

    const params: IUpdateVoucherParams = {};
    if (prolongDurationInSec) params.prolongDuration = durationInBlocks;
    if (addPrograms) {
      params.appendPrograms = addPrograms;
      voucher.programs.push(...addPrograms);
    }
    if (topUp > 0) params.balanceTopUp = topUp * BigInt(1e12);

    this.logger.log(`Updating voucher: ${voucher.voucherId} for ${voucher.account}`);

    const tx = this.api.voucher.update(voucher.account, voucher.voucherId, params);

    const blockHash = await new Promise<HexString>((resolve, reject) => {
      tx.signAndSend(this.account, ({ events, status }) => {
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
      });
    });

    if (durationInBlocks) {
      const blockNumber = (await this.api.blocks.getBlockNumber(blockHash)).toNumber();
      voucher.validUpToBlock = BigInt(blockNumber + durationInBlocks);
      voucher.validUpTo = new Date(Date.now() + prolongDurationInSec * 1000);
      voucher.revoked = false;
    }

    this.logger.log(`Voucher updated: ${voucher.voucherId} valid until ${voucher.validUpTo.toISOString()}`);
    await this.repo.save(voucher);
  }

  async revoke(voucher: Voucher) {
    const tx = this.api.voucher.revoke(voucher.account, voucher.voucherId);
    try {
      await new Promise<HexString>((resolve, reject) => {
        tx.signAndSend(this.account, ({ events, status }) => {
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
        });
      });
    } catch (e) {
      this.logger.error(`Failed to revoke voucher ${voucher.voucherId}`, e);
      return;
    }
    voucher.revoked = true;
    await this.repo.save(voucher);
  }

  async getVoucher(account: string): Promise<Voucher | null> {
    return this.repo.findOneBy({ account });
  }
}
