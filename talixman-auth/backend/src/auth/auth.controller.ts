import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuditAction } from '../common/decorators/audit-action.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { ActivateDto } from './dto/activate.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SessionService } from './services/session.service';
import type { SessionData } from './services/session.service';

// Rate limiting resserré sur toutes les routes /auth/* (en plus du throttling par email/token
// applicatif dans AuthService) : 20 requêtes / minute / IP.
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly session: SessionService,
  ) {}

  @Public()
  @Get('activation/:token')
  getActivationContext(@Param('token') token: string) {
    return this.authService.getActivationContext(token);
  }

  @Public()
  @AuditAction('ACTIVATE_ACCOUNT')
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  activate(@Body() dto: ActivateDto) {
    return this.authService.activate(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @AuditAction('LOGIN_SUCCESS')
  @Post('login/verify-otp')
  @HttpCode(HttpStatus.OK)
  verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.verifyLoginOtp(dto, res);
  }

  // Réinitialisation en libre-service. Les trois routes sont publiques par
  // nature (l'utilisateur n'a justement plus accès à son compte) ; la sécurité
  // repose sur le token opaque envoyé par email ET sur le code TOTP exigé à
  // l'étape finale.
  @Public()
  @AuditAction('PASSWORD_RESET_REQUEST')
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Public()
  @Get('password/reset/:token')
  getPasswordResetContext(@Param('token') token: string) {
    return this.authService.getPasswordResetContext(token);
  }

  @Public()
  @AuditAction('PASSWORD_RESET')
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.session.destroySession(req, res);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: SessionData) {
    return user;
  }

  @AuditAction('PASSWORD_CHANGE')
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() actor: SessionData,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(actor, dto);
  }
}
