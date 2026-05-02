import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentPending } from '../entities/agent-pending.entity';
import { ChainSubmitter } from './chain-submitter.service';
import { NameValidator } from './name.validator';
import { NonceService } from './nonce.service';
import { OffchainManagerClient } from './offchain-manager.client';
import { RateLimitService } from './ratelimit.service';
import {
  AgentSignedPayload,
  SignatureVerifier,
} from './signature.verifier';

export type RegisterFailure =
  | 'expired'
  | 'replay'
  | 'invalid_signature'
  | 'invalid_label'
  | 'name_taken'
  | 'rate_limited'
  | 'audience_mismatch'
  | 'chain_failed';

export type RegisterResult =
  | { ok: true; label: string }
  | { ok: false; reason: RegisterFailure; message?: string };

export type UpdateFailure =
  | 'expired'
  | 'replay'
  | 'invalid_signature'
  | 'audience_mismatch'
  | 'rate_limited'
  | 'forbidden'
  | 'not_registered'
  | 'invalid_field';

export type UpdateResult =
  | { ok: true }
  | { ok: false; reason: UpdateFailure; message?: string };

const IMMUTABLE_METADATA_KEYS = new Set(['varaAddress']);

function validateProfileFields(
  texts?: Record<string, string>,
  metadata?: Record<string, string>,
): { ok: true } | { ok: false; reason: 'invalid_field' } {
  if (texts) {
    if (texts['avatar'] && !/^(https:\/\/|ipfs:\/\/)/.test(texts['avatar']))
      return { ok: false, reason: 'invalid_field' };
    if (texts['url'] && !texts['url'].startsWith('https://'))
      return { ok: false, reason: 'invalid_field' };
    if (texts['description'] && texts['description'].length > 500)
      return { ok: false, reason: 'invalid_field' };
    if (texts['com.twitter'] && !/^[A-Za-z0-9_]{1,32}$/.test(texts['com.twitter']))
      return { ok: false, reason: 'invalid_field' };
  }
  if (metadata) {
    for (const key of Object.keys(metadata)) {
      if (IMMUTABLE_METADATA_KEYS.has(key))
        return { ok: false, reason: 'invalid_field' };
    }
  }
  return { ok: true };
}

interface SignedRequest {
  payload: AgentSignedPayload;
  signature: `0x${string}`;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @InjectRepository(AgentPending)
    private readonly pending: Repository<AgentPending>,
    private readonly config: ConfigService,
    private readonly nameValidator: NameValidator,
    private readonly verifier: SignatureVerifier,
    private readonly nonces: NonceService,
    private readonly limits: RateLimitService,
    private readonly chain: ChainSubmitter,
    private readonly ens: OffchainManagerClient,
  ) {}

  async register(req: SignedRequest): Promise<RegisterResult> {
    const { payload, signature } = req;
    const now = Math.floor(Date.now() / 1000);
    const skew = this.config.get<number>('agents.payloadClockSkewSeconds') ?? 30;
    const maxAge = this.config.get<number>('agents.payloadMaxAgeSeconds') ?? 600;

    if (payload.action !== 'register' || !payload.label) {
      return { ok: false, reason: 'invalid_label' };
    }
    if (payload.audience !== 'polybaskets.eth') {
      return { ok: false, reason: 'audience_mismatch' };
    }
    if (now < payload.issuedAt - skew || now > payload.expiresAt) {
      return { ok: false, reason: 'expired' };
    }
    if (payload.expiresAt - payload.issuedAt > maxAge) {
      return { ok: false, reason: 'expired' };
    }

    const labelOk = this.nameValidator.validate(payload.label);
    if (!labelOk.ok) return { ok: false, reason: 'invalid_label' };

    const nonceOk = await this.nonces.consume(
      payload.nonce,
      new Date((payload.expiresAt + 60) * 1000),
    );
    if (!nonceOk) return { ok: false, reason: 'replay' };

    const sig = this.verifier.verify(payload, signature);
    if (!sig.ok) return { ok: false, reason: 'invalid_signature' };

    if (!(await this.limits.canPerform(payload.ss58, 'register', 'lifetime'))) {
      return { ok: false, reason: 'rate_limited' };
    }

    await this.pending.save({
      ss58: payload.ss58,
      label: payload.label,
      status: 'chain_pending',
      attemptCount: 0,
      errorMessage: null,
    });

    const chainRes = await this.chain.registerAgent(payload.label);
    if (!chainRes.ok) {
      const failRes = chainRes as { ok: false; reason: string; message?: string };
      await this.pending.update(
        { ss58: payload.ss58 },
        {
          status: 'chain_failed',
          errorMessage: failRes.message ?? failRes.reason,
        },
      );
      const reason: RegisterFailure =
        failRes.reason === 'name_taken' ? 'name_taken' : 'chain_failed';
      return { ok: false, reason, message: failRes.message };
    }

    await this.limits.record(payload.ss58, 'register');
    await this.pending.update(
      { ss58: payload.ss58 },
      { status: 'ens_pending', attemptCount: 1 },
    );

    try {
      await this.ens.createForAgent({
        label: payload.label,
        ss58: payload.ss58,
        texts: payload.texts,
        metadata: payload.metadata,
      });
      await this.pending.update(
        { ss58: payload.ss58 },
        { status: 'complete' },
      );
    } catch (err: any) {
      this.logger.warn(
        `ENS create failed for ${payload.label}: ${err?.message}; retry worker will reconcile`,
      );
      await this.pending.update(
        { ss58: payload.ss58 },
        { errorMessage: err?.message ?? 'unknown' },
      );
    }

    return { ok: true, label: payload.label };
  }

  async update(req: SignedRequest): Promise<UpdateResult> {
    const { payload, signature } = req;
    const now = Math.floor(Date.now() / 1000);
    const skew = this.config.get<number>('agents.payloadClockSkewSeconds') ?? 30;

    if (payload.action !== 'update') return { ok: false, reason: 'invalid_field' };
    if (payload.audience !== 'polybaskets.eth')
      return { ok: false, reason: 'audience_mismatch' };
    if (now < payload.issuedAt - skew || now > payload.expiresAt)
      return { ok: false, reason: 'expired' };

    const fields = validateProfileFields(payload.texts, payload.metadata);
    if (!fields.ok) return fields;

    const nonceOk = await this.nonces.consume(
      payload.nonce,
      new Date((payload.expiresAt + 60) * 1000),
    );
    if (!nonceOk) return { ok: false, reason: 'replay' };

    const sig = this.verifier.verify(payload, signature);
    if (!sig.ok) return { ok: false, reason: 'invalid_signature' };

    const existing: any = await this.ens.reverseLookup(payload.ss58);
    if (!existing) return { ok: false, reason: 'not_registered' };
    if (existing.metadata?.varaAddress !== payload.ss58)
      return { ok: false, reason: 'forbidden' };

    if (!(await this.limits.canPerform(payload.ss58, 'update', 'day', 10))) {
      return { ok: false, reason: 'rate_limited' };
    }

    try {
      await this.ens.updateForAgent({
        label: existing.label,
        texts: payload.texts,
        metadata: payload.metadata,
      });
      await this.limits.record(payload.ss58, 'update');
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: 'invalid_field', message: err?.message };
    }
  }
}
