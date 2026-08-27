import { Controller, Get, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface LabComponent {
  key: string;
  label: string;
  port: number;
  service: string;
}

/**
 * Catalogue des composants d'un template, consommé par le portail pour
 * peupler le menu déroulant SUPERADMIN (choix du composant d'un `Service`,
 * remplace l'ancienne `launchUrl` statique). Lit `lab-components.json` à
 * côté du `docker-compose.yml` de chaque template — single source of vérité
 * partagée avec LabsService (construction des URLs par composant) : ajouter
 * un secteur ne nécessite jamais de toucher au code de l'orchestrateur.
 * Séparé de `LabsController` (routes scopées `:labId`) car ceci n'est pas
 * scopé à un labo en particulier — un catalogue, pas une instance.
 */
@Controller('templates')
export class TemplatesController {
  private readonly templatesDir: string;

  constructor(private readonly config: ConfigService) {
    this.templatesDir = this.config.getOrThrow<string>('TEMPLATES_DIR');
  }

  @Get(':template/services')
  getServices(
    @Param('template') template: string,
  ): Array<{ key: string; label: string }> {
    const path = join(this.templatesDir, template, 'lab-components.json');
    // Un template inconnu renvoie une liste vide plutôt qu'une 404 — cohérent
    // avec le comportement du portail pour un secteur sans template configuré.
    if (!existsSync(path)) return [];

    const components = JSON.parse(
      readFileSync(path, 'utf-8'),
    ) as LabComponent[];
    // Contrat API inchangé (`{key,label}[]`) — `port`/`service` restent des
    // détails internes de corrélation avec `docker compose ps` (LabsService).
    return components.map(({ key, label }) => ({ key, label }));
  }
}
