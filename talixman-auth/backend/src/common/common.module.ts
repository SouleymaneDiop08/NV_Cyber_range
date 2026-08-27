import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { CsrfGuard } from './guards/csrf.guard';
import { RolesGuard } from './guards/roles.guard';
import { SectorGuard } from './guards/sector.guard';
import { SessionGuard } from './guards/session.guard';

@Module({
  imports: [AuthModule],
  providers: [
    // Ordre important : rate limit d'abord, puis CSRF, puis résolution de session,
    // puis vérifications de rôle/secteur.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: SectorGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class CommonModule {}
