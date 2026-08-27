import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Response } from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionService } from '../src/auth/services/session.service';
import type { User } from '@prisma/client';

function fakeResponse(onCookie: (sid: string) => void): Response {
  return {
    cookie: (_name: string, value: string) => onCookie(value),
  } as unknown as Response;
}

describe('Services CRUD (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let session: SessionService;
  let sectorId: string;
  let superadminCookie: string;
  let guestCookie: string;
  let guestUser: User;
  let createdServiceId: string;

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
      where: { name: 'raffinerie' },
    });
    sectorId = sector.id;

    const superadmin = await prisma.user.findFirstOrThrow({
      where: { role: 'SUPERADMIN' },
    });
    guestUser = await prisma.user.create({
      data: {
        email: `e2e-guest-${Date.now()}@talixman.local`,
        role: 'GUEST',
        status: 'INVITED',
        sectorId,
      },
    });

    let sid = '';
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

    await session.createSession(
      fakeResponse((v) => (sid = v)),
      {
        userId: guestUser.id,
        role: 'GUEST',
        sectorId,
        firstName: null,
        lastName: null,
      },
    );
    guestCookie = `talixman_sid=${sid}`;
  });

  afterAll(async () => {
    if (createdServiceId) {
      await prisma.service.deleteMany({ where: { id: createdServiceId } });
    }
    await prisma.auditLog.deleteMany({ where: { userId: guestUser.id } });
    await prisma.user.delete({ where: { id: guestUser.id } });
    await app.close();
  });

  it('refuse sans session (401)', async () => {
    await request(app.getHttpServer())
      .get(`/sectors/${sectorId}/services`)
      .expect(401);
  });

  it('refuse un GUEST (403)', async () => {
    await request(app.getHttpServer())
      .get(`/sectors/${sectorId}/services`)
      .set('Cookie', guestCookie)
      .expect(403);
  });

  it('refuse une requête mutante sans header CSRF, même avec une session valide (Phase 8)', async () => {
    await request(app.getHttpServer())
      .post(`/sectors/${sectorId}/services`)
      .set('Cookie', superadminCookie)
      .send({ name: 'X', launchUrl: 'http://x', accessLevel: 'FULL' })
      .expect(403);
  });

  it('SUPERADMIN peut créer, lister, modifier et supprimer un service', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/sectors/${sectorId}/services`)
      .set('Cookie', superadminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        name: 'HMI Poste E2E',
        description: 'Service de test e2e',
        launchUrl: 'http://192.168.99.10:8080',
        accessLevel: 'VIEW_ONLY',
        category: 'SUPERVISION',
      })
      .expect(201);

    expect(createRes.body.name).toBe('HMI Poste E2E');
    expect(createRes.body.enabled).toBe(true);
    createdServiceId = createRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get(`/sectors/${sectorId}/services`)
      .set('Cookie', superadminCookie)
      .expect(200);
    expect(
      listRes.body.some((s: { id: string }) => s.id === createdServiceId),
    ).toBe(true);

    const patchRes = await request(app.getHttpServer())
      .patch(`/sectors/${sectorId}/services/${createdServiceId}`)
      .set('Cookie', superadminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ enabled: false })
      .expect(200);
    expect(patchRes.body.enabled).toBe(false);

    const editRes = await request(app.getHttpServer())
      .patch(`/sectors/${sectorId}/services/${createdServiceId}`)
      .set('Cookie', superadminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        name: 'HMI Poste E2E (modifié)',
        description: 'Description modifiée',
        launchUrl: 'http://192.168.99.99:9090',
        category: 'AUTOMATE',
      })
      .expect(200);
    const editedService = editRes.body as {
      name: string;
      description: string;
      launchUrl: string;
      category: string;
    };
    expect(editedService.name).toBe('HMI Poste E2E (modifié)');
    expect(editedService.description).toBe('Description modifiée');
    expect(editedService.launchUrl).toBe('http://192.168.99.99:9090');
    expect(editedService.category).toBe('AUTOMATE');

    await request(app.getHttpServer())
      .delete(`/sectors/${sectorId}/services/${createdServiceId}`)
      .set('Cookie', superadminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .expect(200);

    const listAfterDelete = await request(app.getHttpServer())
      .get(`/sectors/${sectorId}/services`)
      .set('Cookie', superadminCookie)
      .expect(200);
    expect(
      listAfterDelete.body.some(
        (s: { id: string }) => s.id === createdServiceId,
      ),
    ).toBe(false);
    createdServiceId = '';
  });
});
