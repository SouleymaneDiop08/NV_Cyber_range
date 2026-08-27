import { ForbiddenException, Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60;
const FAIL_PREFIX = 'login-fail:';
const LOCK_PREFIX = 'login-lock:';
const ACTIVATION_FAIL_PREFIX = 'activation-fail:';
const ACTIVATION_LOCK_PREFIX = 'activation-lock:';
const RESET_FAIL_PREFIX = 'reset-fail:';
const RESET_LOCK_PREFIX = 'reset-lock:';
const RESET_REQUEST_PREFIX = 'reset-request:';
// Demandes de réinitialisation autorisées par email et par fenêtre. Sans cette
// borne, la route « mot de passe oublié » devient un moyen d'inonder la boîte
// mail d'un tiers — elle est publique et ne demande rien d'autre qu'un email.
const MAX_RESET_REQUESTS = 3;

@Injectable()
export class LoginThrottleService {
  constructor(private readonly redis: RedisService) {}

  private key(prefix: string, email: string) {
    return prefix + email.toLowerCase();
  }

  async assertNotLocked(email: string): Promise<void> {
    const locked = await this.redis.get(this.key(LOCK_PREFIX, email));
    if (locked) {
      throw new ForbiddenException(
        'Trop de tentatives échouées. Réessayez dans quelques minutes.',
      );
    }
  }

  /** À appeler sur un échec (mauvais mot de passe OU mauvais code TOTP). Verrouille après 5 échecs / 15 min. */
  async recordFailure(email: string): Promise<void> {
    const failKey = this.key(FAIL_PREFIX, email);
    const count = await this.redis.incr(failKey);
    if (count === 1) {
      await this.redis.expire(failKey, WINDOW_SECONDS);
    }
    if (count >= MAX_ATTEMPTS) {
      await this.redis.set(
        this.key(LOCK_PREFIX, email),
        '1',
        'EX',
        WINDOW_SECONDS,
      );
      await this.redis.del(failKey);
    }
  }

  async reset(email: string): Promise<void> {
    await this.redis.del(
      this.key(FAIL_PREFIX, email),
      this.key(LOCK_PREFIX, email),
    );
  }

  /** Même politique que le login, mais bornée par token d'activation (compte pas encore actif). */
  async assertActivationNotLocked(tokenHash: string): Promise<void> {
    const locked = await this.redis.get(ACTIVATION_LOCK_PREFIX + tokenHash);
    if (locked) {
      throw new ForbiddenException(
        'Trop de codes invalides pour cette activation. Réessayez dans quelques minutes.',
      );
    }
  }

  async recordActivationFailure(tokenHash: string): Promise<void> {
    const failKey = ACTIVATION_FAIL_PREFIX + tokenHash;
    const count = await this.redis.incr(failKey);
    if (count === 1) {
      await this.redis.expire(failKey, WINDOW_SECONDS);
    }
    if (count >= MAX_ATTEMPTS) {
      await this.redis.set(
        ACTIVATION_LOCK_PREFIX + tokenHash,
        '1',
        'EX',
        WINDOW_SECONDS,
      );
      await this.redis.del(failKey);
    }
  }

  /** Même politique que l'activation, bornée par token de réinitialisation. */
  async assertResetNotLocked(tokenHash: string): Promise<void> {
    const locked = await this.redis.get(RESET_LOCK_PREFIX + tokenHash);
    if (locked) {
      throw new ForbiddenException(
        'Trop de codes invalides pour cette réinitialisation. Réessayez dans quelques minutes.',
      );
    }
  }

  async recordResetFailure(tokenHash: string): Promise<void> {
    const failKey = RESET_FAIL_PREFIX + tokenHash;
    const count = await this.redis.incr(failKey);
    if (count === 1) {
      await this.redis.expire(failKey, WINDOW_SECONDS);
    }
    if (count >= MAX_ATTEMPTS) {
      await this.redis.set(
        RESET_LOCK_PREFIX + tokenHash,
        '1',
        'EX',
        WINDOW_SECONDS,
      );
      await this.redis.del(failKey);
    }
  }

  /**
   * Borne le nombre de demandes de réinitialisation par email.
   *
   * Ne lève pas : la route appelante doit répondre exactement la même chose
   * qu'en cas de succès, sinon la différence de réponse révélerait quels
   * emails existent en base. Renvoie `false` pour « ne pas envoyer d'email ».
   */
  async allowResetRequest(email: string): Promise<boolean> {
    const key = this.key(RESET_REQUEST_PREFIX, email);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }
    return count <= MAX_RESET_REQUESTS;
  }
}
