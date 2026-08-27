import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;
  private readonly consoleMode: boolean;

  constructor(private readonly config: ConfigService) {
    this.from = this.config.get('SMTP_FROM') ?? 'no-reply@talixman.local';
    this.consoleMode = this.config.get('EMAIL_TRANSPORT') !== 'smtp';

    this.transporter = this.consoleMode
      ? null
      : nodemailer.createTransport({
          host: this.config.getOrThrow<string>('SMTP_HOST'),
          port: Number(this.config.get('SMTP_PORT') ?? 587),
          auth: this.config.get('SMTP_USER')
            ? {
                user: this.config.get('SMTP_USER'),
                pass: this.config.get('SMTP_PASSWORD'),
              }
            : undefined,
        });
  }

  async sendInvitationEmail(to: string, activationUrl: string): Promise<void> {
    const subject = 'Talixman Cyber Range — Activation de votre compte';
    const text = `Bonjour,\n\nUn compte a été créé pour vous sur le portail Talixman Cyber Range.\nActivez-le en suivant ce lien (valable 48h) :\n${activationUrl}\n\nVous devrez choisir un mot de passe et configurer Google Authenticator pour finaliser l'activation.`;
    const html = `<p>Bonjour,</p><p>Un compte a été créé pour vous sur le portail <strong>Talixman Cyber Range</strong>.</p><p>Activez-le en suivant ce lien (valable 48h) :<br><a href="${activationUrl}">${activationUrl}</a></p><p>Vous devrez choisir un mot de passe et configurer Google Authenticator pour finaliser l'activation.</p>`;

    if (this.consoleMode || !this.transporter) {
      this.logger.log(
        `[EMAIL:console] À: ${to} — Sujet: ${subject}\nLien d'activation: ${activationUrl}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text,
      html,
    });
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    const subject =
      'Talixman Cyber Range — Réinitialisation de votre mot de passe';
    const notice =
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste valable.";
    const text = `Bonjour,\n\nUne réinitialisation de mot de passe a été demandée pour votre compte Talixman Cyber Range.\nDéfinissez un nouveau mot de passe en suivant ce lien (valable 1h, utilisable une seule fois) :\n${resetUrl}\n\nLe code de votre application d'authentification vous sera demandé.\n\n${notice}`;
    const html = `<p>Bonjour,</p><p>Une réinitialisation de mot de passe a été demandée pour votre compte <strong>Talixman Cyber Range</strong>.</p><p>Définissez un nouveau mot de passe en suivant ce lien (valable 1h, utilisable une seule fois) :<br><a href="${resetUrl}">${resetUrl}</a></p><p>Le code de votre application d'authentification vous sera demandé.</p><p>${notice}</p>`;

    if (this.consoleMode || !this.transporter) {
      this.logger.log(
        `[EMAIL:console] À: ${to} — Sujet: ${subject}\nLien de réinitialisation: ${resetUrl}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text,
      html,
    });
  }
}
