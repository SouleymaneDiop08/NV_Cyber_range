import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { SessionData } from '../../auth/services/session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ACTION_KEY } from '../decorators/audit-action.decorator';

interface ResultWithUser {
  user?: { id?: string };
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionData }>();

    return next.handle().pipe(
      tap((result) => {
        const userId =
          request.user?.userId ?? (result as ResultWithUser)?.user?.id ?? null;
        this.prisma.auditLog
          .create({ data: { userId, action, ip: request.ip ?? null } })
          .catch((err: unknown) =>
            this.logger.error(`Échec écriture AuditLog (${action})`, err),
          );
      }),
    );
  }
}
