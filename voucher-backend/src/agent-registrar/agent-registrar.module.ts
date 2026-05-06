import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentRegistrarController } from './agent-registrar.controller';
import { AgentRegistrarService } from './agent-registrar.service';
import { OffchainManagerClient } from './offchain-manager.client';
import { VaraAgentReader } from './vara-agent.reader';
import { AgentReconciler } from './agent-reconciler';
import { IpRegisterCap } from './ip-register-cap';

@Module({
  imports: [ConfigModule],
  controllers: [AgentRegistrarController],
  providers: [
    AgentRegistrarService,
    OffchainManagerClient,
    VaraAgentReader,
    AgentReconciler,
    {
      provide: IpRegisterCap,
      useFactory: () => new IpRegisterCap(5),
    },
  ],
  exports: [],
})
export class AgentRegistrarModule {}
