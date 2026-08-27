import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptWithKey,
  encryptWithKey,
  generateOpaqueToken,
  hashOpaqueToken,
  parseHexKey,
} from './aes-gcm.util';

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = parseHexKey(config.getOrThrow<string>('TOTP_ENC_KEY'));
  }

  /** Chiffre une valeur sensible (ex. secret TOTP) au repos. */
  encrypt(plaintext: string): string {
    return encryptWithKey(this.key, plaintext);
  }

  decrypt(payload: string): string {
    return decryptWithKey(this.key, payload);
  }

  /** Génère un secret opaque à usage unique (token d'activation, code de récupération). */
  generateOpaqueToken(bytes = 32): string {
    return generateOpaqueToken(bytes);
  }

  /** Hash rapide (non réversible) pour des secrets déjà à haute entropie — tokens, codes de récupération. */
  hashOpaqueToken(raw: string): string {
    return hashOpaqueToken(raw);
  }
}
