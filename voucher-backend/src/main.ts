import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      'https://polybaskets.xyz',
      'https://app.polybaskets.xyz',
      'http://localhost:8080',
      'http://localhost:5173',
    ],
  });

  const port = app.get(ConfigService).get<number>('port');
  await app.listen(port, () => {
    console.log(`Voucher backend running on port ${port}`);
  });
}
bootstrap();
