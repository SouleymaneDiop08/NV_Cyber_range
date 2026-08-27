import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import type { Response } from 'express';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { CryptoModule } from '../common/crypto/crypto.module';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';

function mockResponse(): Response {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response;
}

describe('AuthService (activation & login)', () => {
  let authService: AuthService;
  let prisma: PrismaService;
  let redis: RedisService;
  let crypto: CryptoService;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        RedisModule,
        CryptoModule,
        AuthModule,
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);
    crypto = moduleRef.get(CryptoService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
    redis.disconnect();
  });

  async function createInvitedUser() {
    const secret = authenticator.generateSecret();
    const email = `test-${randomUUID()}@talixman.local`;
    const user = await prisma.user.create({
      data: {
        email,
        role: 'GUEST',
        status: 'INVITED',
        totpSecretEnc: crypto.encrypt(secret),
      },
    });
    createdUserIds.push(user.id);
    return { user, secret };
  }

  async function createActivationToken(userId: string, expiresInMs: number) {
    const raw = crypto.generateOpaqueToken();
    await prisma.activationToken.create({
      data: {
        userId,
        tokenHash: crypto.hashOpaqueToken(raw),
        expiresAt: new Date(Date.now() + expiresInMs),
      },
    });
    return raw;
  }

  it('rejette un token expiré', async () => {
    const { user } = await createInvitedUser();
    const raw = await createActivationToken(user.id, -1000);

    await expect(
      authService.activate({
        activationToken: raw,
        password: 'un-mot-de-passe-solide',
        totpCode: '000000',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejette un code TOTP invalide', async () => {
    const { user } = await createInvitedUser();
    const raw = await createActivationToken(user.id, 15 * 60 * 1000);

    await expect(
      authService.activate({
        activationToken: raw,
        password: 'un-mot-de-passe-solide',
        totpCode: '000000',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('active le compte avec un token et un code TOTP valides, génère 10 codes de récupération', async () => {
    const { user, secret } = await createInvitedUser();
    const raw = await createActivationToken(user.id, 15 * 60 * 1000);
    const validCode = authenticator.generate(secret);

    const result = await authService.activate({
      activationToken: raw,
      password: 'un-mot-de-passe-solide',
      totpCode: validCode,
    });

    expect(result.recoveryCodes).toHaveLength(10);

    const activated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(activated.status).toBe('ACTIVE');
    expect(activated.passwordHash).toBeTruthy();
    expect(activated.totpActivatedAt).not.toBeNull();

    // Le token ne doit plus être réutilisable.
    await expect(
      authService.activate({
        activationToken: raw,
        password: 'autre-mot-de-passe',
        totpCode: validCode,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('login: refuse un mauvais mot de passe', async () => {
    const { user, secret } = await createInvitedUser();
    const raw = await createActivationToken(user.id, 15 * 60 * 1000);
    await authService.activate({
      activationToken: raw,
      password: 'un-mot-de-passe-solide',
      totpCode: authenticator.generate(secret),
    });

    await expect(
      authService.login({
        email: user.email,
        password: 'mauvais-mot-de-passe',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('login: exige le bon mot de passe puis le bon code TOTP', async () => {
    const { user, secret } = await createInvitedUser();
    const raw = await createActivationToken(user.id, 15 * 60 * 1000);
    await authService.activate({
      activationToken: raw,
      password: 'un-mot-de-passe-solide',
      totpCode: authenticator.generate(secret),
    });

    const { pendingToken } = await authService.login({
      email: user.email,
      password: 'un-mot-de-passe-solide',
    });

    await expect(
      authService.verifyLoginOtp(
        { pendingToken, totpCode: '000000' },
        mockResponse(),
      ),
    ).rejects.toThrow(UnauthorizedException);

    const res = mockResponse();
    const { user: sessionUser } = await authService.verifyLoginOtp(
      { pendingToken, totpCode: authenticator.generate(secret) },
      res,
    );

    expect(sessionUser.email).toBe(user.email);
    expect(res.cookie).toHaveBeenCalled();
  });

  it('verrouille temporairement après 5 codes TOTP invalides consécutifs (Phase 8)', async () => {
    const { user, secret } = await createInvitedUser();
    const raw = await createActivationToken(user.id, 15 * 60 * 1000);
    await authService.activate({
      activationToken: raw,
      password: 'un-mot-de-passe-solide',
      totpCode: authenticator.generate(secret),
    });

    const { pendingToken } = await authService.login({
      email: user.email,
      password: 'un-mot-de-passe-solide',
    });

    for (let i = 0; i < 5; i++) {
      await expect(
        authService.verifyLoginOtp(
          { pendingToken, totpCode: '000000' },
          mockResponse(),
        ),
      ).rejects.toThrow(UnauthorizedException);
    }

    // Le 6e essai est bloqué par le verrou, même avec le bon code.
    await expect(
      authService.verifyLoginOtp(
        { pendingToken, totpCode: authenticator.generate(secret) },
        mockResponse(),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('verrouille temporairement les tentatives de code TOTP invalides à l’activation (Phase 8)', async () => {
    const { user } = await createInvitedUser();
    const raw = await createActivationToken(user.id, 15 * 60 * 1000);

    for (let i = 0; i < 5; i++) {
      await expect(
        authService.activate({
          activationToken: raw,
          password: 'un-mot-de-passe-solide',
          totpCode: '000000',
        }),
      ).rejects.toThrow(BadRequestException);
    }

    await expect(
      authService.activate({
        activationToken: raw,
        password: 'un-mot-de-passe-solide',
        totpCode: '111111',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
