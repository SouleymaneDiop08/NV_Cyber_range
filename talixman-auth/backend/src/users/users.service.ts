import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { authenticator } from 'otplib';
import { CryptoService } from '../common/crypto/crypto.service';
import { EmailService } from '../email/email.service';
import { LabsService } from '../labs/labs.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionData } from '../auth/services/session.service';
import { CreateUserDto } from './dto/create-user.dto';

const ACTIVATION_TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48h

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly labs: LabsService,
  ) {}

  private async resolveTargetSectorId(
    actor: SessionData,
    dto: CreateUserDto,
  ): Promise<string | null> {
    if (actor.role === 'ADMIN') {
      if (dto.role !== 'GUEST') {
        throw new ForbiddenException(
          'Un administrateur ne peut créer que des comptes invités.',
        );
      }
      if (!actor.sectorId) {
        throw new ForbiddenException(
          'Votre compte administrateur n’est rattaché à aucun secteur.',
        );
      }
      return actor.sectorId;
    }

    // actor.role === 'SUPERADMIN'
    if (dto.role === 'SUPERADMIN') {
      return null;
    }

    if (!dto.sectorId) {
      throw new BadRequestException('Le secteur est requis pour ce rôle.');
    }
    const sector = await this.prisma.sector.findUnique({
      where: { id: dto.sectorId },
    });
    if (!sector) {
      throw new BadRequestException('Secteur introuvable.');
    }
    return sector.id;
  }

  async createInvitedUser(actor: SessionData, dto: CreateUserDto) {
    const sectorId = await this.resolveTargetSectorId(actor, dto);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('Un compte existe déjà avec cet email.');
    }

    const secret = authenticator.generateSecret();
    const rawToken = this.crypto.generateOpaqueToken();

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        sectorId,
        status: 'INVITED',
        createdById: actor.userId,
        totpSecretEnc: this.crypto.encrypt(secret),
        activationTokens: {
          create: {
            tokenHash: this.crypto.hashOpaqueToken(rawToken),
            expiresAt: new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS),
          },
        },
      },
    });

    const frontendUrl =
      this.config.get('FRONTEND_URL') ?? 'http://localhost:5173';
    const activationUrl = `${frontendUrl}/activate?token=${rawToken}`;

    // Le compte est déjà créé à ce stade : un échec d'envoi (quota, restriction sandbox du
    // fournisseur email...) ne doit pas faire échouer la requête ni laisser croire que le
    // compte n'existe pas — on le signale via `emailSent` plutôt que de lever une 500.
    let emailSent = true;
    try {
      await this.email.sendInvitationEmail(user.email, activationUrl);
    } catch (err) {
      emailSent = false;
      this.logger.error(
        `Échec de l'envoi de l'email d'invitation à ${user.email}`,
        err,
      );
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      sectorId: user.sectorId,
      status: user.status,
      emailSent,
    };
  }

  async list(role?: Role) {
    const users = await this.prisma.user.findMany({
      where: role ? { role } : undefined,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        sectorId: true,
        status: true,
        createdById: true,
        createdBy: { select: { id: true, email: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return users;
  }

  /**
   * Invités créés par l'appelant, et eux seuls.
   *
   * Volontairement distinct de `list()`, qui n'est pas cloisonné : ouvrir ce
   * dernier aux ADMIN exposerait les invités de tous les autres admins ainsi
   * que les comptes ADMIN/SUPERADMIN. Ici tout dérive de la session, il n'y a
   * donc aucun paramètre à falsifier.
   */
  async listOwnGuests(actor: SessionData) {
    return this.prisma.user.findMany({
      where: { role: 'GUEST', createdById: actor.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        sectorId: true,
        status: true,
        createdById: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Suppression d'un invité par l'admin qui l'a créé.
   *
   * Le même 404 est renvoyé pour un invité inexistant et pour celui d'un autre
   * admin : sans ça, la distinction des messages permettrait d'énumérer les
   * comptes des autres secteurs. Aucun labo n'est détruit — un GUEST n'en
   * possède pas, il hérite de celui de son créateur.
   */
  async removeOwnGuest(actor: SessionData, targetId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: targetId, role: 'GUEST', createdById: actor.userId },
    });
    if (!target) {
      throw new NotFoundException('Invité introuvable.');
    }

    await this.prisma.user.delete({ where: { id: target.id } });
    return { ok: true };
  }

  async remove(actor: SessionData, targetId: string) {
    if (targetId === actor.userId) {
      throw new ForbiddenException(
        'Vous ne pouvez pas supprimer votre propre compte.',
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
    });
    if (!target) {
      throw new NotFoundException('Utilisateur introuvable.');
    }
    if (target.role === 'SUPERADMIN') {
      throw new ForbiddenException(
        'Un compte super administrateur ne peut pas être supprimé ici.',
      );
    }

    if (target.role === 'ADMIN') {
      // Suppression en cascade : un admin supprimé entraîne la suppression automatique de tous
      // les invités qu'il a créés, ET du labo Docker Compose dont il est propriétaire (sinon un
      // projet orphelin continuerait de tourner sans plus aucun compte pour le gérer).
      //
      // Le projet Compose est détruit AVANT toute suppression en base : si l'orchestrateur est
      // injoignable, `teardownNamespaceForOwner` lève et toute la suppression de l'admin est
      // annulée — préférable à supprimer quand même le compte et laisser un labo tournant sans
      // plus aucune trace en base pour le retrouver.
      const lab = await this.labs.teardownNamespaceForOwner(target.id);

      await this.prisma.$transaction([
        this.prisma.user.deleteMany({ where: { createdById: target.id } }),
        ...(lab ? [this.prisma.lab.delete({ where: { id: lab.id } })] : []),
        this.prisma.user.delete({ where: { id: target.id } }),
      ]);
      return { ok: true };
    }

    await this.prisma.user.delete({ where: { id: target.id } });
    return { ok: true };
  }
}
