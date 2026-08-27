import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SectorGuard } from './sector.guard';

function contextWith(
  user: unknown,
  params: Record<string, string>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('SectorGuard', () => {
  function guardWithParam(paramName: string | undefined) {
    const reflector = {
      getAllAndOverride: () => paramName,
    } as unknown as Reflector;
    return new SectorGuard(reflector);
  }

  it('laisse passer si la route ne déclare pas de contrainte de secteur', () => {
    const guard = guardWithParam(undefined);
    expect(
      guard.canActivate(contextWith({ role: 'ADMIN', sectorId: 'sec-1' }, {})),
    ).toBe(true);
  });

  it('laisse toujours passer le SUPERADMIN quel que soit le secteur ciblé', () => {
    const guard = guardWithParam('sectorId');
    const ctx = contextWith(
      { role: 'SUPERADMIN', sectorId: null },
      { sectorId: 'sec-2' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejette un ADMIN qui agit hors de son secteur', () => {
    const guard = guardWithParam('sectorId');
    const ctx = contextWith(
      { role: 'ADMIN', sectorId: 'sec-1' },
      { sectorId: 'sec-2' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('laisse passer un ADMIN qui agit dans son propre secteur', () => {
    const guard = guardWithParam('sectorId');
    const ctx = contextWith(
      { role: 'ADMIN', sectorId: 'sec-1' },
      { sectorId: 'sec-1' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
