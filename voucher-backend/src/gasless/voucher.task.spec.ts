import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VoucherTask } from './voucher.task';
import { VoucherService } from './voucher.service';
import { Voucher } from '../entities/voucher.entity';

function makeVoucher(id: string): Voucher {
  return {
    id,
    voucherId: `0x${id}`,
    account: '0xabc',
    programs: [],
    varaToIssue: 3,
    validUpToBlock: 100n,
    validUpTo: new Date(Date.now() - 1000), // already expired
    lastRenewedAt: new Date(),
    revoked: false,
  } as Voucher;
}

describe('VoucherTask', () => {
  let task: VoucherTask;
  let repo: { find: jest.Mock };
  let voucherSvc: { revoke: jest.Mock };

  beforeEach(async () => {
    repo = { find: jest.fn().mockResolvedValue([]) };
    voucherSvc = { revoke: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        VoucherTask,
        { provide: VoucherService, useValue: voucherSvc },
        { provide: getRepositoryToken(Voucher), useValue: repo },
      ],
    }).compile();

    task = module.get(VoucherTask);
  });

  it('does nothing when no expired vouchers', async () => {
    repo.find.mockResolvedValue([]);
    await task.revokeExpiredVouchers();
    expect(voucherSvc.revoke).not.toHaveBeenCalled();
  });

  it('revokes each expired voucher', async () => {
    const expired = [makeVoucher('aaa'), makeVoucher('bbb'), makeVoucher('ccc')];
    repo.find.mockResolvedValue(expired);
    await task.revokeExpiredVouchers();
    expect(voucherSvc.revoke).toHaveBeenCalledTimes(3);
    expect(voucherSvc.revoke).toHaveBeenCalledWith(expired[0]);
    expect(voucherSvc.revoke).toHaveBeenCalledWith(expired[1]);
    expect(voucherSvc.revoke).toHaveBeenCalledWith(expired[2]);
  });

  it('continues revoking remaining vouchers after one throws', async () => {
    const expired = [makeVoucher('aaa'), makeVoucher('bbb'), makeVoucher('ccc')];
    repo.find.mockResolvedValue(expired);
    voucherSvc.revoke
      .mockResolvedValueOnce(undefined) // aaa ok
      .mockRejectedValueOnce(new Error('chain error')) // bbb throws
      .mockResolvedValueOnce(undefined); // ccc ok
    await task.revokeExpiredVouchers();
    expect(voucherSvc.revoke).toHaveBeenCalledTimes(3);
  });

  it('queries only non-revoked vouchers with validUpTo < now', async () => {
    await task.revokeExpiredVouchers();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revoked: false }),
      }),
    );
  });
});
