import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SessionData } from '../auth/services/session.service';

/**
 * Durée de vie du jeton de lancement : c'est un passage de relais entre le
 * portail et le composant, consommé dans la seconde par une redirection de
 * navigateur. Une minute couvre largement une latence réseau dégradée, et
 * borne la fenêtre d'exploitation si le jeton fuite (historique de navigation,
 * journaux d'un proxy…).
 */
const TOKEN_TTL_SECONDS = 60;

/**
 * Correspondance rôle portail → masque de groupes FUXA.
 * Valeurs issues de `client/src/app/_models/user.ts` du laboratoire :
 * -1/255 = administrateur, 1 = Viewer, 2 = Operator.
 */
const FUXA_GROUPS: Record<SessionData['role'], number> = {
  SUPERADMIN: -1, // administration complète
  ADMIN: 2, // Operator : pilotage et commandes, pas d'édition
  GUEST: 1, // Viewer : lecture seule stricte
};

export interface LaunchTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  name: string;
  groups: number;
  jti: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

@Injectable()
export class LabTokenService {
  private readonly logger = new Logger(LabTokenService.name);
  private readonly masterKey: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('LAB_SSO_MASTER_KEY') ?? '';
    // Clé absente = fonctionnalité désactivée, pas de secret de repli : une
    // valeur par défaut ferait tourner la chaîne avec un secret connu de tous.
    this.masterKey = raw ? Buffer.from(raw, 'hex') : Buffer.alloc(0);
    if (this.masterKey.length === 0) {
      this.logger.warn(
        'LAB_SSO_MASTER_KEY absente — le lancement authentifié des composants est désactivé.',
      );
    } else if (this.masterKey.length < 32) {
      throw new Error(
        'LAB_SSO_MASTER_KEY doit faire au moins 32 octets en hexadécimal (openssl rand -hex 32).',
      );
    }
  }

  get enabled(): boolean {
    return this.masterKey.length > 0;
  }

  /**
   * Secret propre à un laboratoire.
   *
   * Dérivé et jamais transmis : le portail et l'orchestrateur calculent la
   * même valeur à partir de la clé maîtresse, qui ne quitte jamais leur
   * environnement. Un client qui lirait le secret dans SON conteneur ne peut
   * ni remonter à la clé maîtresse (HMAC non réversible), ni dériver le secret
   * d'un autre laboratoire.
   */
  deriveLabSecret(labId: string): Buffer {
    return createHmac('sha256', this.masterKey).update(labId).digest();
  }

  /**
   * Jeton de lancement, signé pour UN laboratoire et UN composant précis.
   *
   * Les trois superviseurs d'un même labo partagent le secret du labo : sans
   * l'audience, un jeton émis pour l'un serait rejouable sur les autres. C'est
   * `aud` qui cloisonne, le composant destinataire devant le vérifier.
   *
   * Le jeton ne porte que ce dont le composant a besoin pour ouvrir une
   * session : aucune empreinte de mot de passe, aucun secret de second
   * facteur, aucun identifiant de session du portail.
   */
  signLaunchToken(params: {
    labId: string;
    component: string;
    user: SessionData;
    email: string;
  }): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: LaunchTokenClaims = {
      iss: 'talixman-portal',
      aud: `${params.labId}:${params.component}`,
      sub: params.user.userId,
      email: params.email,
      name:
        [params.user.firstName, params.user.lastName]
          .filter(Boolean)
          .join(' ') || params.email,
      groups: FUXA_GROUPS[params.user.role],
      jti: randomBytes(16).toString('hex'),
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    };

    // `alg` est figé côté émetteur ET vérifié côté composant : c'est ce qui
    // ferme la confusion d'algorithme (jeton présenté en `none` ou en RS256).
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify(claims));
    const signature = createHmac('sha256', this.deriveLabSecret(params.labId))
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }

  /** Vérification locale — utilisée par les tests, la vérification réelle a lieu dans le composant. */
  verifyLaunchToken(token: string, labId: string): LaunchTokenClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;

    const expected = createHmac('sha256', this.deriveLabSecret(labId))
      .update(`${header}.${payload}`)
      .digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as LaunchTokenClaims;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  }
}
