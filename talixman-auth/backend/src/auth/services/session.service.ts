import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { RedisService } from '../../redis/redis.service';

export interface SessionData {
  userId: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'GUEST';
  sectorId: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface PendingLoginData {
  userId: string;
}

const SESSION_COOKIE = 'talixman_sid';
const SESSION_PREFIX = 'session:';
const PENDING_PREFIX = 'pending-login:';
// Index inverse userId -> sids, uniquement pour pouvoir révoquer d'un coup
// toutes les sessions d'un compte (réinitialisation de mot de passe). Il peut
// contenir des sids déjà expirés : `destroyAllSessionsForUser` supprime
// l'ensemble de toute façon, et le TTL est repoussé à chaque nouvelle session.
const USER_SESSIONS_PREFIX = 'user-sessions:';
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h
const PENDING_TTL_SECONDS = 5 * 60; // 5min

@Injectable()
export class SessionService {
  private readonly isProd: boolean;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.isProd = config.get('NODE_ENV') === 'production';
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'strict' as const,
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: '/',
    };
  }

  async createPendingLogin(data: PendingLoginData): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(
      PENDING_PREFIX + token,
      JSON.stringify(data),
      'EX',
      PENDING_TTL_SECONDS,
    );
    return token;
  }

  /** Consulte l'état d'un login en attente sans le consommer (permet plusieurs tentatives de code TOTP tant que le TTL est valide). */
  async peekPendingLogin(token: string): Promise<PendingLoginData | null> {
    const raw = await this.redis.get(PENDING_PREFIX + token);
    return raw ? (JSON.parse(raw) as PendingLoginData) : null;
  }

  async deletePendingLogin(token: string): Promise<void> {
    await this.redis.del(PENDING_PREFIX + token);
  }

  async createSession(res: Response, data: SessionData): Promise<void> {
    const sid = randomBytes(32).toString('base64url');
    await this.redis.set(
      SESSION_PREFIX + sid,
      JSON.stringify(data),
      'EX',
      SESSION_TTL_SECONDS,
    );
    const userKey = USER_SESSIONS_PREFIX + data.userId;
    await this.redis.sadd(userKey, sid);
    await this.redis.expire(userKey, SESSION_TTL_SECONDS);
    res.cookie(SESSION_COOKIE, sid, this.cookieOptions());
  }

  async getSession(req: Request): Promise<SessionData | null> {
    const sid = (req.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE
    ];
    if (!sid) return null;
    const raw = await this.redis.get(SESSION_PREFIX + sid);
    return raw ? (JSON.parse(raw) as SessionData) : null;
  }

  async destroySession(req: Request, res: Response): Promise<void> {
    const sid = (req.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE
    ];
    if (sid) {
      // Lu avant suppression : c'est la seule façon de retrouver le userId
      // pour retirer le sid de l'index inverse.
      const raw = await this.redis.get(SESSION_PREFIX + sid);
      await this.redis.del(SESSION_PREFIX + sid);
      if (raw) {
        const { userId } = JSON.parse(raw) as SessionData;
        await this.redis.srem(USER_SESSIONS_PREFIX + userId, sid);
      }
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /**
   * Révoque toutes les sessions actives d'un compte.
   *
   * Appelé après une réinitialisation de mot de passe : si celle-ci fait suite
   * à une compromission, laisser vivre les sessions ouvertes reviendrait à
   * changer la serrure sans reprendre les clés déjà distribuées.
   */
  async destroyAllSessionsForUser(userId: string): Promise<void> {
    const userKey = USER_SESSIONS_PREFIX + userId;
    const sids = await this.redis.smembers(userKey);
    if (sids.length > 0) {
      await this.redis.del(...sids.map((sid) => SESSION_PREFIX + sid));
    }
    await this.redis.del(userKey);
  }
}
