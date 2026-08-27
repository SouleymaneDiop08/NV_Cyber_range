import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionData } from '../../auth/services/session.service';
import { SAME_SECTOR_PARAM_KEY } from '../decorators/same-sector.decorator';

@Injectable()
export class SectorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const paramName = this.reflector.getAllAndOverride<string>(
      SAME_SECTOR_PARAM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!paramName) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionData }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Accès refusé.');

    // Le SUPERADMIN n'est rattaché à aucun secteur unique : il accède à tous.
    if (user.role === 'SUPERADMIN') return true;

    const targetSectorId = request.params[paramName];
    if (!targetSectorId || user.sectorId !== targetSectorId) {
      throw new ForbiddenException('Accès refusé en dehors de votre secteur.');
    }
    return true;
  }
}
