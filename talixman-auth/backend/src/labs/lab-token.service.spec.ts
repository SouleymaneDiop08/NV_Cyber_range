import { ConfigService } from '@nestjs/config';
import { LabTokenService } from './lab-token.service';
import type { SessionData } from '../auth/services/session.service';

const MASTER = 'a'.repeat(64); // 32 octets en hexadécimal

function serviceWith(key: string | undefined): LabTokenService {
  const config = {
    get: (k: string) => (k === 'LAB_SSO_MASTER_KEY' ? key : undefined),
  } as unknown as ConfigService;
  return new LabTokenService(config);
}

function session(role: SessionData['role']): SessionData {
  return {
    userId: 'u-1',
    role,
    sectorId: 's-1',
    firstName: 'Mohamed',
    lastName: 'Hassimi',
  };
}

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

let svc: LabTokenService;

beforeEach(() => {
  svc = serviceWith(MASTER);
});

describe('clé maîtresse', () => {
  it('désactive la fonctionnalité plutôt que de retomber sur un secret par défaut', () => {
    // Un secret de repli serait connu de quiconque lit le code : mieux vaut
    // que le lancement authentifié soit inopérant et signalé.
    expect(serviceWith(undefined).enabled).toBe(false);
  });

  it('refuse une clé trop courte', () => {
    expect(() => serviceWith('abcd')).toThrow(/32 octets/);
  });
});

describe('dérivation du secret par labo', () => {
  it('donne un secret différent à chaque labo', () => {
    const a = svc.deriveLabSecret('lab-aaaa');
    const b = svc.deriveLabSecret('lab-bbbb');
    expect(a.equals(b)).toBe(false);
  });

  it('est déterministe — portail et orchestrateur calculent la même valeur', () => {
    expect(
      svc.deriveLabSecret('lab-aaaa').equals(svc.deriveLabSecret('lab-aaaa')),
    ).toBe(true);
  });

  it('ne révèle pas la clé maîtresse', () => {
    // HMAC n'est pas réversible : le secret d'un labo ne permet pas de
    // remonter à la clé, donc pas de dériver celui d'un autre labo.
    const secret = svc.deriveLabSecret('lab-aaaa').toString('hex');
    expect(secret).not.toContain(MASTER);
    expect(MASTER).not.toContain(secret);
  });
});

describe('signature du jeton', () => {
  const base = {
    labId: 'lab-aaaa',
    component: 'scada-station-a',
    email: 'mohamed@talixman.com',
  };

  it('est vérifiable avec le secret de SON labo', () => {
    const token = svc.signLaunchToken({ ...base, user: session('ADMIN') });
    expect(svc.verifyLaunchToken(token, 'lab-aaaa')).not.toBeNull();
  });

  it('est rejeté avec le secret d’un AUTRE labo', () => {
    // La garantie centrale du cloisonnement : un client ne peut pas forger ni
    // rejouer un jeton chez un autre client.
    const token = svc.signLaunchToken({ ...base, user: session('ADMIN') });
    expect(svc.verifyLaunchToken(token, 'lab-bbbb')).toBeNull();
  });

  it('lie le jeton à un labo ET à un composant précis', () => {
    // Les superviseurs d'un même labo partagent son secret : sans l'audience,
    // un jeton émis pour l'un serait rejouable sur les autres.
    const token = svc.signLaunchToken({ ...base, user: session('ADMIN') });
    expect(claimsOf(token).aud).toBe('lab-aaaa:scada-station-a');
  });

  it('rejette une charge utile modifiée', () => {
    const token = svc.signLaunchToken({ ...base, user: session('GUEST') });
    const [h, , s] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...claimsOf(token), groups: -1 }),
    ).toString('base64url');
    expect(svc.verifyLaunchToken(`${h}.${forged}.${s}`, 'lab-aaaa')).toBeNull();
  });

  it('expire vite — la fenêtre d’exploitation d’une fuite est bornée', () => {
    const c = claimsOf(
      svc.signLaunchToken({ ...base, user: session('ADMIN') }),
    ) as unknown as { iat: number; exp: number };
    expect(c.exp - c.iat).toBeLessThanOrEqual(60);
  });

  it('rejette un jeton expiré', () => {
    const token = svc.signLaunchToken({ ...base, user: session('ADMIN') });
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    expect(svc.verifyLaunchToken(token, 'lab-aaaa')).toBeNull();
    jest.restoreAllMocks();
  });

  it('porte un identifiant unique, support de l’anti-rejeu', () => {
    const a = claimsOf(svc.signLaunchToken({ ...base, user: session('ADMIN') }));
    const b = claimsOf(svc.signLaunchToken({ ...base, user: session('ADMIN') }));
    expect(a.jti).not.toBe(b.jti);
  });

  it('fige l’algorithme dans l’en-tête', () => {
    const token = svc.signLaunchToken({ ...base, user: session('ADMIN') });
    const header = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
    ) as { alg: string };
    expect(header.alg).toBe('HS256');
  });
});

describe('contenu du jeton', () => {
  const base = {
    labId: 'lab-aaaa',
    component: 'scada-scentral',
    email: 'x@talixman.com',
  };

  it.each([
    ['SUPERADMIN', -1],
    ['ADMIN', 2],
    ['GUEST', 1],
  ])('traduit le rôle %s en groupe FUXA %s', (role, expected) => {
    const c = claimsOf(
      svc.signLaunchToken({
        ...base,
        user: session(role as SessionData['role']),
      }),
    );
    expect(c.groups).toBe(expected);
  });

  it('n’expose que le strict nécessaire', () => {
    // Rien qui puisse servir ailleurs si le jeton fuite : ni empreinte de mot
    // de passe, ni secret de second facteur, ni identifiant de session.
    const c = claimsOf(
      svc.signLaunchToken({ ...base, user: session('ADMIN') }),
    );
    expect(Object.keys(c).sort()).toEqual(
      ['aud', 'email', 'exp', 'groups', 'iat', 'iss', 'jti', 'name', 'sub'].sort(),
    );
  });
});
