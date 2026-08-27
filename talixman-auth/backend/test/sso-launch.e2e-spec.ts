import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionService } from '../src/auth/services/session.service';
import { KeycloakService } from '../src/keycloak/keycloak.service';

function fakeResponse(onCookie: (sid: string) => void): Response {
  return {
    cookie: (_name: string, value: string) => onCookie(value),
  } as unknown as Response;
}

describe('Lancement SSO FUXA via /me/services/:id/launch (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let session: SessionService;
  let keycloak: KeycloakService;
  let sectorId: string;
  let admin: User;
  let guest: User;
  let adminCookie: string;
  let guestCookie: string;
  let ssoServiceId: string;
  let ssoServiceGuestViewableId: string;
  let plainServiceId: string;
  const createdUserIds: string[] = [];
  const createdServiceIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    session = app.get(SessionService);
    keycloak = app.get(KeycloakService);

    const sector = await prisma.sector.findFirstOrThrow({
      where: { name: 'dispatching_electrique' },
    });
    sectorId = sector.id;

    admin = await prisma.user.create({
      data: {
        email: `e2e-sso-admin-${Date.now()}@talixman.local`,
        role: 'ADMIN',
        status: 'ACTIVE',
        sectorId,
        firstName: 'SSO',
        lastName: 'Admin',
      },
    });
    createdUserIds.push(admin.id);

    guest = await prisma.user.create({
      data: {
        email: `e2e-sso-guest-${Date.now()}@talixman.local`,
        role: 'GUEST',
        status: 'ACTIVE',
        sectorId,
        firstName: 'SSO',
        lastName: 'Guest',
      },
    });
    createdUserIds.push(guest.id);

    // Miroir Keycloak requis pour l'admin — non déclenché ici car l'utilisateur est créé
    // directement en base (pas via UsersService.createInvitedUser) pour simplifier le test.
    await keycloak.syncUser({
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: admin.role,
    });

    const ssoService = await prisma.service.create({
      data: {
        sectorId,
        name: 'FUXA E2E',
        // Doit correspondre au redirectUris enregistré sur le client Keycloak fuxa-scada
        // (http://localhost:1881/*) — Keycloak refuse silencieusement (pas de redirection)
        // un redirect_uri non enregistré, cf. faux négatif rencontré en écrivant ce test.
        launchUrl: 'http://localhost:1881',
        enabled: true,
        accessLevel: 'FULL',
        ssoTarget: 'FUXA',
      },
    });
    ssoServiceId = ssoService.id;
    createdServiceIds.push(ssoService.id);

    const ssoServiceGuestViewable = await prisma.service.create({
      data: {
        sectorId,
        name: 'FUXA E2E (vue invité)',
        launchUrl: 'http://localhost:19999',
        enabled: true,
        accessLevel: 'VIEW_ONLY',
        ssoTarget: 'FUXA',
      },
    });
    ssoServiceGuestViewableId = ssoServiceGuestViewable.id;
    createdServiceIds.push(ssoServiceGuestViewable.id);

    const plainService = await prisma.service.create({
      data: {
        sectorId,
        name: 'Sans SSO',
        launchUrl: 'http://localhost:29999',
        enabled: true,
        accessLevel: 'VIEW_ONLY',
      },
    });
    plainServiceId = plainService.id;
    createdServiceIds.push(plainService.id);

    let sid = '';
    await session.createSession(
      fakeResponse((v) => (sid = v)),
      {
        userId: admin.id,
        role: 'ADMIN',
        sectorId,
        firstName: admin.firstName,
        lastName: admin.lastName,
      },
    );
    adminCookie = `talixman_sid=${sid}`;

    await session.createSession(
      fakeResponse((v) => (sid = v)),
      {
        userId: guest.id,
        role: 'GUEST',
        sectorId,
        firstName: guest.firstName,
        lastName: guest.lastName,
      },
    );
    guestCookie = `talixman_sid=${sid}`;
  });

  afterAll(async () => {
    await keycloak.deleteUser(admin.email);
    await prisma.service.deleteMany({
      where: { id: { in: createdServiceIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  it('un service sans ssoTarget redirige directement vers launchUrl, sans appel Keycloak', async () => {
    const res = await request(app.getHttpServer())
      .get(`/me/services/${plainServiceId}/launch`)
      .set('Cookie', adminCookie)
      .redirects(0)
      .expect(302);
    expect(res.headers.location).toBe('http://localhost:29999');
  });

  it('un GUEST est toujours redirigé directement, même sur un service SSO (accès natif FUXA "guest")', async () => {
    const res = await request(app.getHttpServer())
      .get(`/me/services/${ssoServiceGuestViewableId}/launch`)
      .set('Cookie', guestCookie)
      .redirects(0)
      .expect(302);
    expect(res.headers.location).toBe('http://localhost:19999');
  });

  it('un ADMIN sur un service ssoTarget=FUXA obtient un token Keycloak dans la redirection', async () => {
    const res = await request(app.getHttpServer())
      .get(`/me/services/${ssoServiceId}/launch`)
      .set('Cookie', adminCookie)
      .redirects(0)
      .expect(302);

    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(
      'http://localhost:1881/api/sso/callback',
    );
    const kcToken = location.searchParams.get('kc_token');
    expect(kcToken).toBeTruthy();

    const payload = JSON.parse(
      Buffer.from(kcToken!.split('.')[1], 'base64').toString('utf8'),
    ) as {
      preferred_username: string;
      realm_access: { roles: string[] };
      azp: string;
    };
    expect(payload.preferred_username).toBe(admin.email);
    expect(payload.realm_access.roles).toContain('talixman-admin');
    expect(payload.azp).toBe('fuxa-scada');
  }, 20_000);
});
