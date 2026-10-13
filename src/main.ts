import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.use(cookieParser());

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  console.log(`Backend API (BFF) running on port ${port}`);
}

bootstrap();