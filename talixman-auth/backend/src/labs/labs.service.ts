import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Lab } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionData } from '../auth/services/session.service';
import { OrchestratorClientService } from './orchestrator-client.service';
import { namespaceForOwner } from './namespace.util';
import { LabStatusResponseDto } from './dto/lab-status.dto';

@Injectable()
export class LabsService {
  private readonly logger = new Logger(LabsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: OrchestratorClientService,
  ) {}

  private static readonly ABSENT: LabStatusResponseDto = {
    labId: null,
    exists: false,
    status: 'ABSENT',
    services: [],
  };

  /**
   * Interroge toujours l'état LIVE de l'orchestrateur (jamais la seule valeur DB,
   * potentiellement périmée) et rafraîchit `Lab.status` comme cache. Si
   * l'orchestrateur ne voit plus le labo (ABSENT) alors qu'une ligne `Lab`
   * existe encore côté portail — projet Compose supprimé manuellement... —
   * la ligne orpheline est nettoyée automatiquement plutôt que de laisser le
   * labo bloqué dans un état incohérent.
   */
  private async resolveLiveStatus(lab: Lab): Promise<LabStatusResponseDto> {
    const live = await this.orchestrator.getStatus(lab.namespace);

    if (live.status === 'ABSENT') {
      await this.prisma.lab
        .delete({ where: { id: lab.id } })
        .catch(() => undefined);
      return LabsService.ABSENT;
    }

    await this.prisma.lab.update({
      where: { id: lab.id },
      data: { status: live.status },
    });

    return {
      labId: lab.namespace,
      exists: live.exists,
      status: live.status,
      services: live.services,
    };
  }

  /**
   * Résout le `Lab` d'un utilisateur, quel que soit son rôle : un ADMIN a le
   * sien, un GUEST hérite de celui de l'ADMIN qui l'a créé (résolution par
   * `createdById`, pas par `sectorId` — un secteur peut avoir plusieurs ADMIN,
   * chacun son labo indépendant, cf. plan). Point d'entrée unique réutilisé par
   * `getStatusForAdmin`/`getStatusForGuest`/`getLaunchUrlForUser` — pas de
   * logique de résolution dupliquée.
   */
  private async resolveLabForUser(user: SessionData): Promise<Lab | null> {
    if (user.role === 'GUEST') {
      const guestUser = await this.prisma.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { createdById: true },
      });
      if (!guestUser.createdById) return null;
      return this.prisma.lab.findUnique({
        where: { ownerId: guestUser.createdById },
      });
    }
    return this.prisma.lab.findUnique({ where: { ownerId: user.userId } });
  }

  async getStatusForAdmin(admin: SessionData): Promise<LabStatusResponseDto> {
    const lab = await this.resolveLabForUser(admin);
    if (!lab) return LabsService.ABSENT;
    return this.resolveLiveStatus(lab);
  }

  async getStatusForGuest(guest: SessionData): Promise<LabStatusResponseDto> {
    const lab = await this.resolveLabForUser(guest);
    if (!lab) return LabsService.ABSENT;
    return this.resolveLiveStatus(lab);
  }

  /**
   * Résout l'URL de lancement d'un composant pour l'utilisateur courant —
   * utilisé par `MeController.launchService` à la place de l'ancienne
   * `launchUrl` statique. `labComponent` est déjà validé à la création du
   * `Service` (cf. ServicesService.create/update) contre la liste live de
   * l'orchestrateur, donc `UNKNOWN_COMPONENT` ne devrait jamais survenir en
   * pratique — gardé par défensivité plutôt que supposé impossible.
   */
  async getLaunchUrlForUser(
    user: SessionData,
    labComponent: string,
  ): Promise<
    // `labId` remonte avec l'URL : c'est lui qui permet de dériver le secret
    // propre au laboratoire pour signer le jeton de lancement.
    | { ok: true; url: string; labId: string }
    | { ok: false; reason: 'NO_LAB' | 'NOT_RUNNING' | 'UNKNOWN_COMPONENT' }
  > {
    const lab = await this.resolveLabForUser(user);
    if (!lab) return { ok: false, reason: 'NO_LAB' };

    const live = await this.orchestrator.getStatus(lab.namespace);
    if (live.status !== 'RUNNING') {
      return { ok: false, reason: 'NOT_RUNNING' };
    }

    const service = live.services.find((s) => s.name === labComponent);
    if (!service) return { ok: false, reason: 'UNKNOWN_COMPONENT' };
    return { ok: true, url: service.url, labId: lab.namespace };
  }

  /**
   * Résout le template Docker Compose du secteur de l'admin (`Sector.templateName`)
   * — c'est le portail qui possède cette association, l'orchestrateur reçoit
   * juste le nom du template à exécuter et n'a aucune notion de secteur.
   */
  private async resolveTemplateForAdmin(admin: SessionData): Promise<string> {
    if (!admin.sectorId) {
      throw new UnprocessableEntityException(
        "Aucun secteur n'est associé à ce compte administrateur.",
      );
    }
    const sector = await this.prisma.sector.findUniqueOrThrow({
      where: { id: admin.sectorId },
      select: { templateName: true },
    });
    if (!sector.templateName) {
      throw new UnprocessableEntityException(
        "Aucun template de laboratoire n'est configuré pour ce secteur.",
      );
    }
    return sector.templateName;
  }

  async startForAdmin(admin: SessionData): Promise<LabStatusResponseDto> {
    let lab = await this.prisma.lab.findUnique({
      where: { ownerId: admin.userId },
    });

    if (!lab) {
      const template = await this.resolveTemplateForAdmin(admin);
      const namespace = namespaceForOwner(admin.userId);
      this.logger.log(
        `Création du labo ${namespace} (template ${template}) pour l'admin ${admin.userId}`,
      );
      // Idempotent côté orchestrateur (create-or-get) : si cet appel réussit mais
      // que l'insertion Prisma qui suit échoue, un retry ultérieur ne recréera
      // pas de ressources en double.
      await this.orchestrator.createOrGet(namespace, template);
      lab = await this.prisma.lab.create({
        data: { ownerId: admin.userId, namespace, status: 'CREATING' },
      });
    }

    await this.orchestrator.start(lab.namespace);
    return this.resolveLiveStatus(lab);
  }

  async stopForAdmin(admin: SessionData): Promise<LabStatusResponseDto> {
    const lab = await this.prisma.lab.findUnique({
      where: { ownerId: admin.userId },
    });
    if (!lab) {
      throw new NotFoundException('Aucun laboratoire à arrêter.');
    }
    await this.orchestrator.stop(lab.namespace);
    return this.resolveLiveStatus(lab);
  }

  async pauseForAdmin(admin: SessionData): Promise<LabStatusResponseDto> {
    const lab = await this.prisma.lab.findUnique({
      where: { ownerId: admin.userId },
    });
    if (!lab) {
      throw new NotFoundException('Aucun laboratoire à suspendre.');
    }
    await this.orchestrator.pause(lab.namespace);
    return this.resolveLiveStatus(lab);
  }

  async resumeForAdmin(admin: SessionData): Promise<LabStatusResponseDto> {
    const lab = await this.prisma.lab.findUnique({
      where: { ownerId: admin.userId },
    });
    if (!lab) {
      throw new NotFoundException('Aucun laboratoire à reprendre.');
    }
    await this.orchestrator.resume(lab.namespace);
    return this.resolveLiveStatus(lab);
  }

  async deleteForAdmin(admin: SessionData): Promise<void> {
    const lab = await this.prisma.lab.findUnique({
      where: { ownerId: admin.userId },
    });
    if (!lab) return; // idempotent, comme la suppression côté orchestrateur
    await this.orchestrator.delete(lab.namespace);
    await this.prisma.lab.delete({ where: { id: lab.id } });
  }

  /**
   * Utilisé uniquement par UsersService.remove lors de la suppression d'un ADMIN
   * (cascade). Détruit le projet Compose AVANT toute suppression en base — si
   * l'orchestrateur est injoignable, l'exception remonte et annule toute la
   * suppression de l'ADMIN plutôt que de laisser un labo orphelin sans aucune
   * trace en base. Renvoie la ligne `Lab` (pour que l'appelant l'inclue dans
   * sa propre transaction) ou `null` si l'admin n'avait pas de labo.
   */
  async teardownNamespaceForOwner(ownerId: string): Promise<Lab | null> {
    const lab = await this.prisma.lab.findUnique({ where: { ownerId } });
    if (!lab) return null;
    await this.orchestrator.delete(lab.namespace);
    return lab;
  }
}
