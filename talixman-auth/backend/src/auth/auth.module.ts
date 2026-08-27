import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginThrottleService } from './services/login-throttle.service';
import { PasswordService } from './services/password.service';
import { RecoveryCodeService } from './services/recovery-code.service';
import { SessionService } from './services/session.service';
import { TotpService } from './services/totp.service';

@Module({
  // EmailModule est @Global(), mais l'importer ici rend AuthModule autonome —
  // c'est ce qui permet à auth.service.spec.ts de le compiler seul.
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TotpService,
    RecoveryCodeService,
    SessionService,
    LoginThrottleService,
  ],
  exports: [SessionService],
})
export class AuthModule {}
