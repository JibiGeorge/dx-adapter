import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TenantRepository } from './repositories/tenant.repository.js';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const uri = configService.getOrThrow<string>('CONFIG_MONGO_URL');
        return {
          uri,
          serverSelectionTimeoutMS: 5_000,
          socketTimeoutMS: 30_000,
          connectTimeoutMS: 10_000,
          maxPoolSize: 10,
          retryWrites: true,
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [TenantRepository],
  exports: [TenantRepository],
})
export class DatabaseModule {}
