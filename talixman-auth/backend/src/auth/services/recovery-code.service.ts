import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CryptoService } from '../../common/crypto/crypto.service';

const CODE_COUNT = 10;

@Injectable()
export class RecoveryCodeService {
  constructor(private readonly crypto: CryptoService) {}

  /** Génère des codes lisibles (ex. `A1B2C-3D4E5`) et leur hash pour stockage. */
  generateBatch(count = CODE_COUNT): { raw: string; hash: string }[] {
    return Array.from({ length: count }, () => {
      const raw = randomBytes(5)
        .toString('hex')
        .toUpperCase()
        .match(/.{1,5}/g)!
        .join('-');
      return { raw, hash: this.crypto.hashOpaqueToken(raw) };
    });
  }

  matches(raw: string, hash: string): boolean {
    return this.crypto.hashOpaqueToken(raw.trim().toUpperCase()) === hash;
  }
}
