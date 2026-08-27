import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function contextWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  function guardWithRoles(roles: string[] | undefined) {
    const reflector = {
      getAllAndOverride: () => roles,
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it("laisse passer si aucune restriction de rôle n'est déclarée", () => {
    const guard = guardWithRoles(undefined);
    expect(guard.canActivate(contextWithUser({ role: 'GUEST' }))).toBe(true);
  });

  it('laisse toujours passer le SUPERADMIN, même hors de la liste de rôles', () => {
    const guard = guardWithRoles(['ADMIN']);
    expect(guard.canActivate(contextWithUser({ role: 'SUPERADMIN' }))).toBe(
      true,
    );
  });

  it('rejette un GUEST sur une route réservée ADMIN/SUPERADMIN', () => {
    const guard = guardWithRoles(['ADMIN', 'SUPERADMIN']);
    expect(() => guard.canActivate(contextWithUser({ role: 'GUEST' }))).toThrow(
      ForbiddenException,
    );
  });

  it('laisse passer un ADMIN sur une route qui l’autorise', () => {
    const guard = guardWithRoles(['ADMIN', 'SUPERADMIN']);
    expect(guard.canActivate(contextWithUser({ role: 'ADMIN' }))).toBe(true);
  });
});
