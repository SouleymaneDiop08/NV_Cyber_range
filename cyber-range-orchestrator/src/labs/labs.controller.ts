import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { LabsService } from './labs.service';
import { LabStatusDto } from './dto/lab-status.dto';

/**
 * API interne (authentifiée par ServiceTokenGuard, cf. app.module.ts) — le
 * seul appelant légitime est talixman-auth/backend. Adressée par :labId
 * car c'est le portail qui décide/possède le nommage (cf. plan) ; l'orchestrateur
 * est un exécutant sans logique de propriété/RBAC, cette couche est déjà gérée
 * côté portail (routes /labs/me* dans talixman-auth).
 */
@Controller('labs')
export class LabsController {
  constructor(private readonly labsService: LabsService) {}

  @Put(':labId')
  createOrGet(
    @Param('labId') labId: string,
    @Body('template') template: string,
  ): Promise<LabStatusDto> {
    return this.labsService.createOrGet(labId, template);
  }

  @Post(':labId/start')
  start(@Param('labId') labId: string): Promise<LabStatusDto> {
    return this.labsService.start(labId);
  }

  @Post(':labId/stop')
  stop(@Param('labId') labId: string): Promise<LabStatusDto> {
    return this.labsService.stop(labId);
  }

  @Post(':labId/pause')
  pause(@Param('labId') labId: string): Promise<LabStatusDto> {
    return this.labsService.pause(labId);
  }

  @Post(':labId/resume')
  resume(@Param('labId') labId: string): Promise<LabStatusDto> {
    return this.labsService.resume(labId);
  }

  @Delete(':labId')
  async remove(@Param('labId') labId: string): Promise<{ ok: true }> {
    await this.labsService.delete(labId);
    return { ok: true };
  }

  @Get(':labId')
  getStatus(@Param('labId') labId: string): Promise<LabStatusDto> {
    return this.labsService.getStatus(labId);
  }
}
