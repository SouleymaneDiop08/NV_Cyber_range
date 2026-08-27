import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { EmailModule } from './email/email.module';
import { LabsModule } from './labs/labs.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SectorsModule } from './sectors/sectors.module';
import { ServicesModule } from './services/services.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PrismaModule,
    RedisModule,
    CryptoModule,
    EmailModule,
    AuthModule,
    CommonModule,
    SectorsModule,
    ServicesModule,
    LabsModule,
    UsersModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
