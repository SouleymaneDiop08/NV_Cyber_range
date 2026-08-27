import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { OrchestratorClientService } from '../labs/orchestrator-client.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: OrchestratorClientService,
  ) {}

  private async assertSectorExists(sectorId: string) {
    const sector = await this.prisma.sector.findUnique({
      where: { id: sectorId },
    });
    if (!sector) throw new NotFoundException('Secteur introuvable.');
    return sector;
  }

  /**
   * Composants K8s valides pour le template du secteur (menu déroulant
   * SUPERADMIN, remplace l'ancienne URL de lancement statique). Un secteur
   * sans `templateName` (pas encore de labo K8s) renvoie simplement une liste
   * vide — état légitime aujourd'hui pour tout secteur hors dispatching, pas
   * une erreur.
   */
  async listLabComponents(sectorId: string) {
    const sector = await this.assertSectorExists(sectorId);
    if (!sector.templateName) return [];
    return this.orchestrator.getTemplateServices(sector.templateName);
  }

  private async assertValidLabComponent(
    sectorId: string,
    labComponent: string,
  ) {
    const components = await this.listLabComponents(sectorId);
    if (!components.some((c) => c.key === labComponent)) {
      throw new BadRequestException(
        `Composant "${labComponent}" invalide pour ce secteur.`,
      );
    }
  }

  async create(sectorId: string, dto: CreateServiceDto) {
    await this.assertSectorExists(sectorId);
    await this.assertValidLabComponent(sectorId, dto.labComponent);
    return this.prisma.service.create({
      data: { ...dto, sectorId },
    });
  }

  async findAllBySector(sectorId: string) {
    await this.assertSectorExists(sectorId);
    return this.prisma.service.findMany({
      where: { sectorId },
      orderBy: { name: 'asc' },
    });
  }

  private async findOneInSector(sectorId: string, id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, sectorId },
    });
    if (!service) throw new NotFoundException('Service introuvable.');
    return service;
  }

  async update(sectorId: string, id: string, dto: UpdateServiceDto) {
    await this.findOneInSector(sectorId, id);
    if (dto.labComponent) {
      await this.assertValidLabComponent(sectorId, dto.labComponent);
    }
    return this.prisma.service.update({ where: { id }, data: dto });
  }

  async remove(sectorId: string, id: string) {
    await this.findOneInSector(sectorId, id);
    await this.prisma.service.delete({ where: { id } });
    return { ok: true };
  }

  /** Services actifs du secteur d'un utilisateur connecté, filtrés par son niveau d'accès. */
  async findForUser(sectorId: string | null, role: Role) {
    if (!sectorId) return [];
    return this.prisma.service.findMany({
      where: {
        sectorId,
        enabled: true,
        ...(role === 'GUEST' ? { accessLevel: 'VIEW_ONLY' } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  /** Un service unique, avec les mêmes règles d'accès que findForUser (secteur, actif, niveau). */
  async findOneForUser(sectorId: string | null, role: Role, id: string) {
    if (!sectorId) throw new NotFoundException('Service introuvable.');
    const service = await this.prisma.service.findFirst({
      where: {
        id,
        sectorId,
        enabled: true,
        ...(role === 'GUEST' ? { accessLevel: 'VIEW_ONLY' } : {}),
      },
    });
    if (!service) throw new NotFoundException('Service introuvable.');
    return service;
  }
}
