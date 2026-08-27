import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Défense en profondeur en complément de `SameSite=Strict` sur le cookie de session :
 * exige un header custom sur les requêtes mutantes. Un formulaire HTML cross-site ne peut
 * pas fixer ce header, ce qui bloque le CSRF même si `SameSite` venait à être contourné
 * (proxy, ancien navigateur, extension...).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;

    if (request.headers['x-requested-with'] !== 'XMLHttpRequest') {
      throw new ForbiddenException('Requête refusée (protection CSRF).');
    }
    return true;
  }
}
