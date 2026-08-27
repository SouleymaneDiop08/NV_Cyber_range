import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Response } from 'express';
import type { Service } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionService } from '../src/auth/services/session.service';

function fakeResponse(onCookie: (sid: string) => void): Response {
  return {
    cookie: (_name: string, value: string) => onCookie(value),
  } as unknown as Response;
}

describe('GET /me/services (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let session: SessionService;
  let sectorId: string;
  let adminCookie: string;
  let guestCookie: string;
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

    const sector = await prisma.sector.findFirstOrThrow({
      where: { name: 'systeme_ferroviaire' },
    });
    sectorId = sector.id;

    const full = await prisma.service.create({
      data: {
        sectorId,
        name: 'PLC Test FULL',
        launchUrl: 'http://192.168.50.10:8080',
        accessLevel: 'FULL',
        enabled: true,
      },
    });
    const viewOnly = await prisma.service.create({
      data: {
        sectorId,
        name: 'Vue 3D Test',
        launchUrl: 'http://192.168.50.11:8080',
        accessLevel: 'VIEW_ONLY',
        enabled: true,
      },
    });
    const disabled = await prisma.service.create({
      data: {
        sectorId,
        name: 'Service désactivé',
        launchUrl: 'http://192.168.50.12:8080',
        accessLevel: 'VIEW_ONLY',
        enabled: false,
      },
    });
    createdServiceIds.push(full.id, viewOnly.id, disabled.id);

    let sid = '';
    await session.createSession(
      fakeResponse((v) => (sid = v)),
      {
        userId: 'e2e-admin-me',
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
        userId: 'e2e-guest-me',
        role: 'GUEST',
        sectorId,
        firstName: null,
        lastName: null,
      },
    );
    guestCookie = `talixman_sid=${sid}`;
  });

  afterAll(async () => {
    await prisma.service.deleteMany({
      where: { id: { in: createdServiceIds } },
    });
    await app.close();
  });

  it('un ADMIN voit les services actifs FULL et VIEW_ONLY de son secteur (pas les désactivés)', async () => {
    const res = await request(app.getHttpServer())
      .get('/me/services')
      .set('Cookie', adminCookie)
      .expect(200);
    const names = (res.body as Service[]).map((s) => s.name);
    expect(names).toContain('PLC Test FULL');
    expect(names).toContain('Vue 3D Test');
    expect(names).not.toContain('Service désactivé');
  });

  it('un GUEST ne voit que les services VIEW_ONLY actifs', async () => {
    const res = await request(app.getHttpServer())
      .get('/me/services')
      .set('Cookie', guestCookie)
      .expect(200);
    const names = (res.body as Service[]).map((s) => s.name);
    expect(names).toContain('Vue 3D Test');
    expect(names).not.toContain('PLC Test FULL');
    expect(names).not.toContain('Service désactivé');
  });

  it('sans session → 401', async () => {
    await request(app.getHttpServer()).get('/me/services').expect(401);
  });
});
