import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { authenticator } from 'otplib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionService } from '../src/auth/services/session.service';
import { EmailService } from '../src/email/email.service';
import { CryptoService } from '../src/common/crypto/crypto.service';

function fakeResponse(onCookie: (sid: string) => void): Response {
  return {
    cookie: (_name: string, value: string) => onCookie(value),
  } as unknown as Response;
}

describe('Users invitation flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let session: SessionService;
  let sendInvitationEmail: jest.Mock;
  let sectorId: string;
  let adminUser: User;
  let adminCookie: string;
  let guestCookie: string;
  let superadminCookie: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    sendInvitationEmail = jest.fn().mockResolvedValue(undefined);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue({ sendInvitationEmail })
      .compile();

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

    const sector = await prisma.sector.findFirstOrThrow({
      where: { name: 'dispatching_electrique' },
    });
    sectorId = sector.id;

    adminUser = await prisma.user.create({
      data: {
        email: `e2e-admin-${Date.now()}@talixman.local`,
        role: 'ADMIN',
        status: 'ACTIVE',
        sectorId,
      },
    });
    createdUserIds.push(adminUser.id);

    const superadmin = await prisma.user.findFirstOrThrow({
      where: { role: 'SUPERADMIN' },
    });

    let sid = '';
    await session.createSession(
      fakeResponse((v) => (sid = v)),
      {
        userId: adminUser.id,
        role: 'ADMIN',
        sectorId,
        firstName: null,
        lastName: null,
      },
    );
    adminCookie = `talixman_sid=${sid}`;

    await session.createSession(
      fakeResponse((v) => (sid = v)),
      {
        userId: 'e2e-guest-placeholder',
        role: 'GUEST',
        sectorId,
        firstName: null,
        lastName: null,
      },
    );
    guestCookie = `talixman_sid=${sid}`;

    await session.createSession(
      fakeResponse((v) => (sid = v)),
      {
        userId: superadmin.id,
        role: 'SUPERADMIN',
        sectorId: null,
        firstName: null,
        lastName: null,
      },
    );
    superadminCookie = `talixman_sid=${sid}`;
  });

  afterAll(async () => {
    await prisma.recoveryCode.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.activationToken.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  it('un GUEST ne peut pas créer de compte (403)', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Cookie', guestCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: `x-${Date.now()}@talixman.local`, role: 'GUEST' })
      .expect(403);
  });

  it("un ADMIN ne peut créer qu'un GUEST (403 s'il tente ADMIN)", async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        email: `x-${Date.now()}@talixman.local`,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'ADMIN',
      })
      .expect(403);
  });

  it('un SUPERADMIN qui crée un ADMIN sans secteur reçoit 400', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Cookie', superadminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        email: `x-${Date.now()}@talixman.local`,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'ADMIN',
      })
      .expect(400);
  });

  it("ADMIN crée un GUEST dans son propre secteur, un email d'activation part, et le lien mène à une activation réussie", async () => {
    const email = `e2e-invite-${Date.now()}@talixman.local`;

    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email, firstName: 'Jean', lastName: 'Dupont', role: 'GUEST' })
      .expect(201);

    expect(res.body.role).toBe('GUEST');
    expect(res.body.sectorId).toBe(sectorId);
    expect(res.body.status).toBe('INVITED');
    createdUserIds.push(res.body.id);

    expect(sendInvitationEmail).toHaveBeenCalledWith(
      email,
      expect.stringContaining('/activate?token='),
    );
    const activationUrl: string = sendInvitationEmail.mock.calls.at(-1)![1];
    const rawToken = new URL(activationUrl).searchParams.get('token')!;

    const ctxRes = await request(app.getHttpServer())
      .get(`/auth/activation/${rawToken}`)
      .expect(200);
    expect(ctxRes.body.email).toBe(email);

    // Le secret TOTP n'est jamais exposé en clair par l'API : on le relit en DB (déchiffré)
    // pour simuler le code que l'utilisateur lirait sur son app Google Authenticator après scan du QR.
    const crypto = app.get(CryptoService);
    const createdUser = await prisma.user.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    const secret = crypto.decrypt(createdUser.totpSecretEnc!);
    const validCode = authenticator.generate(secret);

    const activateRes = await request(app.getHttpServer())
      .post('/auth/activate')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        activationToken: rawToken,
        password: 'un-mot-de-passe-solide',
        totpCode: validCode,
      })
      .expect(200);
    expect(activateRes.body.recoveryCodes).toHaveLength(10);

    const activated = await prisma.user.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(activated.status).toBe('ACTIVE');
  });

  it('un SUPERADMIN peut créer un autre SUPERADMIN, avec prénom/nom stockés', async () => {
    const email = `e2e-superadmin-${Date.now()}@talixman.local`;

    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Cookie', superadminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email, firstName: 'Aïda', lastName: 'FALL', role: 'SUPERADMIN' })
      .expect(201);

    const created = res.body as {
      id: string;
      role: string;
      sectorId: string | null;
      firstName: string;
      lastName: string;
    };
    expect(created.role).toBe('SUPERADMIN');
    expect(created.sectorId).toBeNull();
    expect(created.firstName).toBe('Aïda');
    expect(created.lastName).toBe('FALL');
    createdUserIds.push(created.id);
  });

  it('la création de compte échoue sans prénom/nom (400)', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: `x-${Date.now()}@talixman.local`, role: 'GUEST' })
      .expect(400);
  });

  it('un ADMIN ne peut pas lister ni supprimer des utilisateurs (403)', async () => {
    await request(app.getHttpServer())
      .get('/users')
      .set('Cookie', adminCookie)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/users/${adminUser.id}`)
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .expect(403);
  });

  it('le SUPERADMIN liste les GUEST avec leur créateur', async () => {
    interface ListedUser {
      id: string;
      createdById: string | null;
      createdBy: { id: string; email: string } | null;
      passwordHash?: string;
    }

    const res = await request(app.getHttpServer())
      .get('/users?role=GUEST')
      .set('Cookie', superadminCookie)
      .expect(200);

    const body = res.body as ListedUser[];
    expect(Array.isArray(body)).toBe(true);
    const guest = body.find((u) => u.createdById === adminUser.id);
    expect(guest).toBeDefined();
    expect(guest?.createdBy).toEqual({
      id: adminUser.id,
      email: adminUser.email,
    });
    expect(guest?.passwordHash).toBeUndefined();
  });

  it('le SUPERADMIN ne peut pas se supprimer lui-même, ni supprimer un SUPERADMIN', async () => {
    const superadmin = await prisma.user.findFirstOrThrow({
      where: { role: 'SUPERADMIN' },
    });

    await request(app.getHttpServer())
      .delete(`/users/${superadmin.id}`)
      .set('Cookie', superadminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .expect(403);
  });

  it('supprimer un ADMIN supprime automatiquement tous ses invités (cascade)', async () => {
    const cascadeAdmin = await prisma.user.create({
      data: {
        email: `e2e-cascade-admin-${Date.now()}@talixman.local`,
        role: 'ADMIN',
        status: 'ACTIVE',
        sectorId,
      },
    });

    const cascadeGuest = await prisma.user.create({
      data: {
        email: `e2e-cascade-guest-${Date.now()}@talixman.local`,
        role: 'GUEST',
        status: 'INVITED',
        sectorId,
        createdById: cascadeAdmin.id,
      },
    });

    await request(app.getHttpServer())
      .delete(`/users/${cascadeAdmin.id}`)
      .set('Cookie', superadminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .expect(200);

    const admin = await prisma.user.findUnique({
      where: { id: cascadeAdmin.id },
    });
    const guest = await prisma.user.findUnique({
      where: { id: cascadeGuest.id },
    });
    expect(admin).toBeNull();
    expect(guest).toBeNull();
  });
});
