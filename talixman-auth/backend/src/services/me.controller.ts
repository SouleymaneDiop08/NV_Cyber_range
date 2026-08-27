import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LabTokenService } from '../labs/lab-token.service';
import { LabsService } from '../labs/labs.service';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionData } from '../auth/services/session.service';
import { ServicesService } from './services.service';

@Controller('me')
export class MeController {
  private readonly logger = new Logger(MeController.name);

  constructor(
    private readonly servicesService: ServicesService,
    private readonly prisma: PrismaService,
    private readonly labsService: LabsService,
    private readonly labTokens: LabTokenService,
  ) {}

  @Get('services')
  findMyServices(@CurrentUser() user: SessionData) {
    return this.servicesService.findForUser(user.sectorId, user.role);
  }

  /**
   * Lance un service. L'URL n'est pas stockée : elle est calculée à la demande
   * à partir du labo de l'utilisateur courant
   * (`LabsService.getLaunchUrlForUser` — résolution ADMIN/GUEST déjà en place
   * pour le reste du cycle de vie du labo) et du composant choisi par le
   * SUPERADMIN pour ce `Service` (`labComponent`).
   *
   * Pour un service marqué `ssoTarget`, le portail signe un jeton de lancement
   * de courte durée que le composant vérifie LOCALEMENT, avec le secret dérivé
   * de son laboratoire. Aucun appel sortant depuis le labo n'est nécessaire —
   * c'est ce qui permet de garder son réseau totalement cloisonné.
   */
  @Get('services/:id/launch')
  async launchService(
    @CurrentUser() user: SessionData,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const service = await this.servicesService.findOneForUser(
      user.sectorId,
      user.role,
      id,
    );

    const launch = await this.labsService.getLaunchUrlForUser(
      user,
      service.labComponent,
    );
    if (!launch.ok) {
      const labStatus =
        launch.reason === 'NOT_RUNNING' ? 'not_running' : 'absent';
      return res.redirect(`/?labStatus=${labStatus}`);
    }

    if (!service.ssoTarget || !this.labTokens.enabled) {
      return res.redirect(launch.url);
    }

    try {
      const actor = await this.prisma.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { email: true },
      });
      const token = this.labTokens.signLaunchToken({
        labId: launch.labId,
        component: service.labComponent,
        user,
        email: actor.email,
      });
      // Un chemin absolu passé à `new URL` écraserait le chemin de base de
      // l'URL de lancement — on concatène donc explicitement.
      const target = new URL(`${launch.url}/api/sso/callback`);
      target.searchParams.set('token', token);
      return res.redirect(target.toString());
    } catch (err) {
      // Jamais le jeton ni le secret dans les journaux : seulement le service.
      this.logger.error(
        `Échec du lancement authentifié pour le service ${service.id}`,
        err,
      );
      return res.redirect(launch.url);
    }
  }
}
