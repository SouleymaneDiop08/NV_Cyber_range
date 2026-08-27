import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Seule authentification de cette API : un secret partagé avec talixman-auth/backend
 * (ORCHESTRATOR_SERVICE_TOKEN des deux côtés). Cette API n'est jamais exposée
 * publiquement — un seul appelant légitime (le backend portail), donc pas besoin
 * d'identité par requête, juste une preuve que l'appelant est bien le portail.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const expected = this.config.getOrThrow<string>(
      'ORCHESTRATOR_SERVICE_TOKEN',
    );

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de service manquant');
    }
    const token = header.slice('Bearer '.length);
    if (token !== expected) {
      throw new UnauthorizedException('Token de service invalide');
    }
    return true;
  }
}
