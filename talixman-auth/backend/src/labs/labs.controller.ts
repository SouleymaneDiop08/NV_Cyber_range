import { Controller, Delete, Get, Post } from '@nestjs/common';
import { AuditAction } from '../common/decorators/audit-action.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { SessionData } from '../auth/services/session.service';
import { LabsService } from './labs.service';
import type { LabStatusResponseDto } from './dto/lab-status.dto';

/**
 * Routes `/labs/me*` uniquement — jamais de `:namespace`/`:ownerId` côté client,
 * tout dérive de la session (même logique que MeController pour les services) :
 * élimine toute surface IDOR, un ADMIN ne peut même pas tenter d'adresser le
 * labo d'un autre admin via un paramètre d'URL.
 */
@Controller('labs')
export class LabsController {
  constructor(private readonly labsService: LabsService) {}

  @Get('me')
  getMine(@CurrentUser() user: SessionData): Promise<LabStatusResponseDto> {
    if (user.role === 'GUEST') {
      return this.labsService.getStatusForGuest(user);
    }
    return this.labsService.getStatusForAdmin(user);
  }

  @Post('me/start')
  @Roles('ADMIN')
  @AuditAction('LAB_START')
  start(@CurrentUser() user: SessionData): Promise<LabStatusResponseDto> {
    return this.labsService.startForAdmin(user);
  }

  @Post('me/stop')
  @Roles('ADMIN')
  @AuditAction('LAB_STOP')
  stop(@CurrentUser() user: SessionData): Promise<LabStatusResponseDto> {
    return this.labsService.stopForAdmin(user);
  }

  @Post('me/pause')
  @Roles('ADMIN')
  @AuditAction('LAB_PAUSE')
  pause(@CurrentUser() user: SessionData): Promise<LabStatusResponseDto> {
    return this.labsService.pauseForAdmin(user);
  }

  @Post('me/resume')
  @Roles('ADMIN')
  @AuditAction('LAB_RESUME')
  resume(@CurrentUser() user: SessionData): Promise<LabStatusResponseDto> {
    return this.labsService.resumeForAdmin(user);
  }

  @Delete('me')
  @Roles('ADMIN')
  @AuditAction('LAB_DELETE')
  async remove(@CurrentUser() user: SessionData): Promise<{ ok: true }> {
    await this.labsService.deleteForAdmin(user);
    return { ok: true };
  }
}
