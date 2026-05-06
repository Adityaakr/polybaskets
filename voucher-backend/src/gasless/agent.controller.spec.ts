import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

describe('AgentController', () => {
  let controller: AgentController;
  let service: jest.Mocked<AgentService>;

  beforeEach(async () => {
    service = {
      register: jest.fn(),
      update: jest.fn(),
      forward: jest.fn(),
      reverse: jest.fn(),
      bulkReverse: jest.fn(),
      availability: jest.fn(),
    } as any;

    const module = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [{ provide: AgentService, useValue: service }],
    }).compile();
    controller = module.get(AgentController);
  });

  describe('POST /register', () => {
    it('returns label on success', async () => {
      service.register.mockResolvedValueOnce({ ok: true, label: 'alice' });
      await expect(
        controller.register({ payload: {}, signature: '0xabc' } as any),
      ).resolves.toEqual({ label: 'alice' });
    });

    it('throws BadRequest on expired', async () => {
      service.register.mockResolvedValueOnce({
        ok: false,
        reason: 'expired',
      } as any);
      await expect(
        controller.register({ payload: {}, signature: '0xabc' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws Unauthorized on invalid_signature', async () => {
      service.register.mockResolvedValueOnce({
        ok: false,
        reason: 'invalid_signature',
      } as any);
      await expect(
        controller.register({ payload: {}, signature: '0xabc' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws Conflict on name_taken', async () => {
      service.register.mockResolvedValueOnce({
        ok: false,
        reason: 'name_taken',
      } as any);
      await expect(
        controller.register({ payload: {}, signature: '0xabc' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws 429 on rate_limited', async () => {
      service.register.mockResolvedValueOnce({
        ok: false,
        reason: 'rate_limited',
      } as any);
      try {
        await controller.register({ payload: {}, signature: '0xabc' } as any);
        fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(429);
      }
    });

    it('throws 502 on chain_failed', async () => {
      service.register.mockResolvedValueOnce({
        ok: false,
        reason: 'chain_failed',
        message: 'node down',
      } as any);
      try {
        await controller.register({ payload: {}, signature: '0xabc' } as any);
        fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(502);
      }
    });
  });

  describe('PATCH /profile', () => {
    it('throws Forbidden on forbidden', async () => {
      service.update.mockResolvedValueOnce({
        ok: false,
        reason: 'forbidden',
      } as any);
      await expect(
        controller.update({ payload: {}, signature: '0xabc' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFound on not_registered', async () => {
      service.update.mockResolvedValueOnce({
        ok: false,
        reason: 'not_registered',
      } as any);
      await expect(
        controller.update({ payload: {}, signature: '0xabc' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns ok on success', async () => {
      service.update.mockResolvedValueOnce({ ok: true });
      await expect(
        controller.update({ payload: {}, signature: '0xabc' } as any),
      ).resolves.toEqual({ ok: true });
    });
  });

  describe('GET routes', () => {
    it('availability delegates', async () => {
      service.availability.mockResolvedValueOnce({ available: true });
      await expect(controller.availability('alice')).resolves.toEqual({
        available: true,
      });
      expect(service.availability).toHaveBeenCalledWith('alice');
    });

    it('byLabel returns null when not found', async () => {
      service.forward.mockResolvedValueOnce(null);
      await expect(controller.byLabel('ghost')).resolves.toBeNull();
    });

    it('byAddress delegates', async () => {
      service.reverse.mockResolvedValueOnce({ label: 'alice' } as any);
      await expect(controller.byAddress('kGkAlice')).resolves.toEqual({
        label: 'alice',
      });
    });
  });

  describe('POST /by-addresses', () => {
    it('rejects non-array body', async () => {
      await expect(
        controller.byAddresses({ ss58s: 'not-an-array' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delegates with the array', async () => {
      service.bulkReverse.mockResolvedValueOnce({ a: null, b: null });
      const result = await controller.byAddresses({ ss58s: ['a', 'b'] });
      expect(result).toEqual({ a: null, b: null });
      expect(service.bulkReverse).toHaveBeenCalledWith(['a', 'b']);
    });
  });
});
