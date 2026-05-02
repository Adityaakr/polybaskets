import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { GaslessProgram } from '../entities/gasless-program.entity';
import { Voucher } from '../entities/voucher.entity';
import { IpTrancheUsage } from '../entities/ip-tranche-usage.entity';
import { AgentNonce } from '../entities/agent-nonce.entity';
import { AgentActionLog } from '../entities/agent-action-log.entity';
import { AgentPending } from '../entities/agent-pending.entity';
import { GaslessService } from './gasless.service';
import { GaslessController } from './gasless.controller';
import { VoucherService } from './voucher.service';
import { VoucherTask } from './voucher.task';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { NameValidator } from './name.validator';
import { SignatureVerifier } from './signature.verifier';
import { NonceService } from './nonce.service';
import { RateLimitService } from './ratelimit.service';
import { ChainSubmitter } from './chain-submitter.service';
import { OffchainManagerClient } from './offchain-manager.client';
import { RetryWorker } from './retry-worker.task';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      GaslessProgram,
      Voucher,
      IpTrancheUsage,
      AgentNonce,
      AgentActionLog,
      AgentPending,
    ]),
  ],
  controllers: [GaslessController, AgentController],
  providers: [
    GaslessService,
    VoucherService,
    VoucherTask,
    AgentService,
    NameValidator,
    SignatureVerifier,
    NonceService,
    RateLimitService,
    ChainSubmitter,
    OffchainManagerClient,
    RetryWorker,
  ],
  exports: [GaslessService, VoucherService],
})
export class GaslessModule {}
