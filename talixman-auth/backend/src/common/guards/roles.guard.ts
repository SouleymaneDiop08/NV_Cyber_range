import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { SessionData } from '../../auth/services/session.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionData }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Accès refusé.');

    // Le SUPERADMIN (équipe Talixman) accède à tout, sans restriction de rôle.
    if (user.role === 'SUPERADMIN') return true;

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Accès refusé pour ce rôle.');
    }
    return true;
  }
}
