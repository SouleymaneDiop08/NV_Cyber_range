import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CryptoService } from '../common/crypto/crypto.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivateDto } from './dto/activate.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginThrottleService } from './services/login-throttle.service';
import { PasswordService } from './services/password.service';
import { RecoveryCodeService } from './services/recovery-code.service';
import { SessionData, SessionService } from './services/session.service';
import { TotpService } from './services/totp.service';

export interface PublicUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: SessionData['role'];
  sectorId: string | null;
}

// Bien plus court que les 48h d'une invitation : ce lien redonne l'accès à un
// compte actif, sa fenêtre d'exposition doit rester minimale.
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly password: PasswordService,
    private readonly totp: TotpService,
    private readonly recoveryCodes: RecoveryCodeService,
    private readonly session: SessionService,
    private readonly loginThrottle: LoginThrottleService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private async findValidActivationToken(rawToken: string) {
    const tokenHash = this.crypto.hashOpaqueToken(rawToken);
    const token = await this.prisma.activationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!token) {
      throw new BadRequestException("Lien d'activation invalide.");
    }
    if (token.usedAt) {
      throw new BadRequestException("Ce lien d'activation a déjà été utilisé.");
    }
    if (token.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Ce lien d'activation a expiré.");
    }
    if (!token.user.totpSecretEnc) {
      throw new BadRequestException('Compte invalide : secret TOTP manquant.');
    }
    return token;
  }

  async getActivationContext(rawToken: string) {
    const token = await this.findValidActivationToken(rawToken);
    const secret = this.crypto.decrypt(token.user.totpSecretEnc!);
    const otpauthUrl = this.totp.buildOtpAuthUrl(secret, token.user.email);
    const qrCodeDataUrl = await this.totp.generateQrCodeDataUrl(otpauthUrl);
    return { email: token.user.email, otpauthUrl, qrCodeDataUrl };
  }

  async activate(dto: ActivateDto): Promise<{ recoveryCodes: string[] }> {
    const token = await this.findValidActivationToken(dto.activationToken);
    await this.loginThrottle.assertActivationNotLocked(token.tokenHash);

    const secret = this.crypto.decrypt(token.user.totpSecretEnc!);

    if (!this.totp.verifyCode(secret, dto.totpCode)) {
      await this.loginThrottle.recordActivationFailure(token.tokenHash);
      throw new BadRequestException('Code TOTP invalide.');
    }

    const passwordHash = await this.password.hash(dto.password);
    const codes = this.recoveryCodes.generateBatch();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          status: 'ACTIVE',
          totpActivatedAt: new Date(),
        },
      }),
      this.prisma.recoveryCode.createMany({
        data: codes.map((c) => ({ userId: token.userId, codeHash: c.hash })),
      }),
      this.prisma.activationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { recoveryCodes: codes.map((c) => c.raw) };
  }

  async login(dto: LoginDto): Promise<{ pendingToken: string }> {
    await this.loginThrottle.assertNotLocked(dto.email);

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    const genericError = () =>
      new UnauthorizedException('Identifiants invalides.');

    if (!user || !user.passwordHash || user.status !== 'ACTIVE') {
      await this.loginThrottle.recordFailure(dto.email);
      throw genericError();
    }

    const valid = await this.password.verify(user.passwordHash, dto.password);
    if (!valid) {
      await this.loginThrottle.recordFailure(dto.email);
      throw genericError();
    }

    // Le compteur d'échecs n'est pas réinitialisé ici : le login n'est complet qu'après le code TOTP.
    const pendingToken = await this.session.createPendingLogin({
      userId: user.id,
    });
    return { pendingToken };
  }

  async verifyLoginOtp(
    dto: VerifyOtpDto,
    res: Response,
  ): Promise<{ user: PublicUser }> {
    const pending = await this.session.peekPendingLogin(dto.pendingToken);
    if (!pending) {
      throw new UnauthorizedException(
        'Session de connexion expirée, veuillez vous reconnecter.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: pending.userId },
    });
    if (!user || !user.totpSecretEnc || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Compte invalide.');
    }

    await this.loginThrottle.assertNotLocked(user.email);

    const secret = this.crypto.decrypt(user.totpSecretEnc);
    if (!this.totp.verifyCode(secret, dto.totpCode)) {
      await this.loginThrottle.recordFailure(user.email);
      throw new UnauthorizedException('Code invalide.');
    }

    await this.loginThrottle.reset(user.email);
    await this.session.deletePendingLogin(dto.pendingToken);

    const sessionData: SessionData = {
      userId: user.id,
      role: user.role,
      sectorId: user.sectorId,
      firstName: user.firstName,
      lastName: user.lastName,
    };
    await this.session.createSession(res, sessionData);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        sectorId: user.sectorId,
      },
    };
  }

  async changePassword(
    actor: SessionData,
    dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Compte invalide.');
    }

    const valid = await this.password.verify(
      user.passwordHash,
      dto.currentPassword,
    );
    if (!valid) {
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    }

    const passwordHash = await this.password.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return { ok: true };
  }

  private async findValidPasswordResetToken(rawToken: string) {
    const tokenHash = this.crypto.hashOpaqueToken(rawToken);
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!token) {
      throw new BadRequestException('Lien de réinitialisation invalide.');
    }
    if (token.usedAt) {
      throw new BadRequestException(
        'Ce lien de réinitialisation a déjà été utilisé.',
      );
    }
    if (token.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Ce lien de réinitialisation a expiré.');
    }
    if (!token.user.totpSecretEnc) {
      throw new BadRequestException('Compte invalide : secret TOTP manquant.');
    }
    return token;
  }

  /**
   * Demande de réinitialisation.
   *
   * Répond toujours la même chose, quoi qu'il arrive — email inconnu, compte
   * désactivé, quota atteint, panne d'envoi. Toute réponse différenciée
   * transformerait cette route publique en oracle permettant d'énumérer les
   * comptes existants.
   */
  async requestPasswordReset(dto: ForgotPasswordDto): Promise<{ ok: true }> {
    const generic = { ok: true } as const;

    if (!(await this.loginThrottle.allowResetRequest(dto.email))) {
      return generic;
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // Un compte encore INVITED n'a pas de mot de passe à réinitialiser : c'est
    // son lien d'activation qui s'applique. Un compte DISABLED ne doit rien
    // recevoir.
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !user.passwordHash ||
      !user.totpSecretEnc
    ) {
      return generic;
    }

    const rawToken = this.crypto.generateOpaqueToken();
    const tokenHash = this.crypto.hashOpaqueToken(rawToken);

    await this.prisma.$transaction([
      // Un seul lien vivant à la fois : une nouvelle demande périme les
      // précédentes, sinon chaque clic laisserait un lien exploitable de plus.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
        },
      }),
    ]);

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    try {
      await this.email.sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      // Même traitement que l'invitation : l'échec d'envoi est journalisé, pas
      // remonté à l'appelant (il révélerait que le compte existe).
      this.logger.error(
        `Échec de l'envoi de l'email de réinitialisation à ${user.email}`,
        err,
      );
    }

    return generic;
  }

  /** Contexte affiché sur la page de réinitialisation (à qui appartient ce lien). */
  async getPasswordResetContext(rawToken: string): Promise<{ email: string }> {
    const token = await this.findValidPasswordResetToken(rawToken);
    return { email: token.user.email };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ ok: true }> {
    const token = await this.findValidPasswordResetToken(dto.resetToken);
    await this.loginThrottle.assertResetNotLocked(token.tokenHash);

    const secret = this.crypto.decrypt(token.user.totpSecretEnc!);
    if (!this.totp.verifyCode(secret, dto.totpCode)) {
      await this.loginThrottle.recordResetFailure(token.tokenHash);
      throw new BadRequestException('Code TOTP invalide.');
    }

    const passwordHash = await this.password.hash(dto.password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // Le verrou de login est levé : c'est très souvent en s'acharnant sur un
    // mot de passe oublié que l'utilisateur l'a déclenché, le laisser en place
    // rendrait le nouveau mot de passe inutilisable pendant 15 minutes.
    await this.loginThrottle.reset(token.user.email);
    await this.session.destroyAllSessionsForUser(token.userId);

    return { ok: true };
  }
}
