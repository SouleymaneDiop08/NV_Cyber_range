import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Response } from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionService } from '../src/auth/services/session.service';
import { PasswordService } from '../src/auth/services/password.service';

function fakeResponse(onCookie: (sid: string) => void): Response {
  return {
    cookie: (_name: string, value: string) => onCookie(value),
  } as unknown as Response;
}

describe('Changement de mot de passe (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let session: SessionService;
  let password: PasswordService;
  let userId: string;
  let cookie: string;

  const initialPassword = 'mot-de-passe-initial';

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
    password = app.get(PasswordService);

    const sector = await prisma.sector.findFirstOrThrow({
      where: { name: 'dispatching_electrique' },
    });
    const user = await prisma.user.create({
      data: {
        email: `e2e-password-${Date.now()}@talixman.local`,
        role: 'GUEST',
        status: 'ACTIVE',
        sectorId: sector.id,
        passwordHash: await password.hash(initialPassword),
      },
    });
    userId = user.id;

    let sid = '';
    await session.createSession(
      fakeResponse((v) => (sid = v)),
      {
        userId: user.id,
        role: 'GUEST',
        sectorId: sector.id,
        firstName: null,
        lastName: null,
      },
    );
    cookie = `talixman_sid=${sid}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  it('refuse un utilisateur non authentifié (401)', async () => {
    await request(app.getHttpServer())
      .patch('/auth/password')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        currentPassword: initialPassword,
        newPassword: 'un-nouveau-mot-de-passe',
      })
      .expect(401);
  });

  it('refuse un nouveau mot de passe trop court (400)', async () => {
    await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ currentPassword: initialPassword, newPassword: 'court' })
      .expect(400);
  });

  it('refuse si le mot de passe actuel est incorrect (401)', async () => {
    await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        currentPassword: 'mauvais-mot-de-passe',
        newPassword: 'un-nouveau-mot-de-passe',
      })
      .expect(401);
  });

  it('met à jour le mot de passe avec les bons identifiants', async () => {
    const newPassword = 'un-nouveau-mot-de-passe-solide';

    await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ currentPassword: initialPassword, newPassword })
      .expect(200);

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(await password.verify(updated.passwordHash!, newPassword)).toBe(
      true,
    );
  });
});
