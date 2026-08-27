import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

const ISSUER = 'Talixman Cyber Range';

@Injectable()
export class TotpService {
  constructor() {
    // Tolère un pas de 30s avant/après pour absorber le décalage d'horloge du client.
    authenticator.options = { window: 1 };
  }

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  buildOtpAuthUrl(secret: string, email: string): string {
    return authenticator.keyuri(email, ISSUER, secret);
  }

  verifyCode(secret: string, token: string): boolean {
    try {
      return authenticator.check(token, secret);
    } catch {
      return false;
    }
  }

  generateQrCodeDataUrl(otpauthUrl: string): Promise<string> {
    return QRCode.toDataURL(otpauthUrl);
  }
}
