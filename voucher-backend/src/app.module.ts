import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { GaslessProgram } from './entities/gasless-program.entity';
import { Voucher } from './entities/voucher.entity';
import { GaslessModule } from './gasless/gasless.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ load: [configuration] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get('database.port'),
        username: config.get('database.user'),
        password: config.get('database.password'),
        database: config.get('database.name'),
        entities: [GaslessProgram, Voucher],
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    GaslessModule,
  ],
})
export class AppModule {}
