import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { TenantModule } from './tenant/tenant.module';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TenantModule
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
