import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  LabAggregateStatus,
  LabServiceStatus,
  LabStatusDto,
} from './dto/lab-status.dto';
// `import type` requis : `LabRuntimeDriver` apparaît dans la signature du
// constructeur décoré ci-dessous, et le couple isolatedModules +
// emitDecoratorMetadata (cf. tsconfig.json) interdit d'y référencer un type
// importé en import de valeur.
import type {
  LabComponentState,
  LabInstanceState,
  LabRuntimeDriver,
  LabTemplate,
} from './runtime/lab-runtime.driver';
import { LAB_RUNTIME_DRIVER } from './runtime/lab-runtime.tokens';
import type { IngressAllocation, LabIngress } from '../ingress/lab-ingress';
import { LAB_INGRESS } from '../ingress/ingress.tokens';

/**
 * Identifiants sûrs à interpoler dans des noms de conteneurs / chemins de
 * fichiers de template. Le portail garantit déjà ce format (`lab-<hash>`), on
 * revalide par défensivité.
 */
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

export interface LabStateEntry {
  template: string;
  createdAt: string;
  /**
   * Dernière consultation du labo par le portail (chaque `getStatus`).
   * Base du nettoyage automatique des labos inactifs (cf. LabsReaperService).
   * Optionnel : les entrées écrites avant l'introduction du champ retombent
   * sur `createdAt`, l'état existant reste donc lisible tel quel.
   */
  lastSeenAt?: string;
  /**
   * Points d'exposition publics des composants, produits par la stratégie
   * d'ingress (cf. LabIngress). Écrit par le rôle `control`, lu par le rôle
   * `gateway` pour savoir quoi servir. Optionnel : un labo créé avant
   * l'introduction de l'ingress reste lisible (ses composants n'auront
   * simplement pas d'URL tant qu'il n'est pas recréé).
   */
  ingress?: IngressAllocation;
}

export type LabsState = Record<string, LabStateEntry>;

/**
 * Route que le rôle `gateway` doit servir : un point d'entrée public vers un
 * composant précis d'un labo. Volontairement exprimée en termes de liaison
 * (`binding`) et non de port, pour que l'ajout d'une stratégie par nom d'hôte
 * n'change pas ce contrat.
 */
export interface IngressRoute {
  labId: string;
  component: string;
  binding: { port?: number; host?: string };
  /** Cible interne : le conteneur du labo et le port du composant. */
  target: { host: string; port: number };
}

/**
 * Fréquence maximale de réécriture de `lastSeenAt`. Le portail interroge
 * l'état en boucle tant qu'un labo est affiché : sans ce garde-fou, chaque
 * sondage réécrirait le fichier d'état. Une minute de granularité est
 * largement suffisante face à des seuils d'inactivité en dizaines de minutes.
 */
const LAST_SEEN_THROTTLE_MS = 60_000;

/** Composant d'un labo, depuis `<template>/lab-components.json`. */
interface LabComponent {
  key: string;
  label: string;
  port: number;
  /** Nom du service Compose, corrélé avec l'état renvoyé par le driver. */
  service: string;
  /**
   * Chemin d'atterrissage optionnel, ajouté à l'origine renvoyée au portail.
   *
   * Sert aux composants dont la racine n'est pas la page utile : noVNC, par
   * exemple, n'expose son client qu'en `/vnc.html`. C'est la seule chose que
   * l'adaptateur nginx du laboratoire faisait encore ; la déclarer ici évite
   * d'avoir à maintenir un conteneur entier pour une redirection.
   *
   * N'affecte que l'URL de premier accès : le composant reste servi à la
   * racine de sa propre origine, ce qui préserve la règle « une origine par
   * composant ».
   */
  path?: string;
}

/**
 * Orchestration métier d'un labo, agnostique du runtime : toute la mécanique
 * conteneurs est déléguée à un `LabRuntimeDriver` (DindComposeDriver en v1 —
 * un conteneur Docker-in-Docker par labo ; KataComposeDriver conservé pour la
 * cible long terme). Ce service ne connaît que : l'état persistant
 * (labId -> template/date/exposition), le catalogue de composants d'un
 * template, et la délégation de la construction des URLs publiques à la
 * stratégie d'ingress. Aucune commande Docker ici, et aucun schéma d'URL en
 * dur : c'est ce qui permet de changer d'exposition (ports -> noms d'hôte)
 * sans toucher au portail.
 */
@Injectable()
export class LabsService {
  private readonly logger = new Logger(LabsService.name);
  private readonly templatesDir: string;
  private readonly stateFile: string;

  /**
   * Verrou en mémoire par labId : deux `createOrGet` concurrents pour le même
   * labo (double-clic pendant une création qui dure) partagent la même
   * création au lieu de lancer deux `docker run --name <labId>` en conflit.
   */
  private readonly inFlightCreations = new Map<string, Promise<LabStatusDto>>();

  constructor(
    private readonly config: ConfigService,
    @Inject(LAB_RUNTIME_DRIVER)
    private readonly runtime: LabRuntimeDriver,
    @Inject(LAB_INGRESS)
    private readonly ingress: LabIngress,
  ) {
    this.templatesDir = this.config.getOrThrow<string>('TEMPLATES_DIR');
    this.stateFile = this.config.getOrThrow<string>('LABS_STATE_FILE');
  }

  /**
   * Créer si absent (idempotent, cf. `PUT /labs/:labId`) : démarre l'instance
   * du labo. Si le labId existe déjà dans l'état, renvoie le statut courant ;
   * si une création est en cours, attend son résultat.
   */
  async createOrGet(labId: string, template: string): Promise<LabStatusDto> {
    this.assertSafeId(labId, 'labId');

    if (this.readState()[labId]) {
      this.logger.log(`Labo ${labId} déjà présent, no-op`);
      return this.getStatus(labId);
    }

    const inFlight = this.inFlightCreations.get(labId);
    if (inFlight) {
      this.logger.log(`Création du labo ${labId} déjà en cours, on attend`);
      return inFlight;
    }

    const creation = this.doCreate(labId, template).finally(() => {
      this.inFlightCreations.delete(labId);
    });
    this.inFlightCreations.set(labId, creation);
    return creation;
  }

  private async doCreate(
    labId: string,
    template: string,
  ): Promise<LabStatusDto> {
    this.assertSafeId(template, 'template');
    const tpl = this.readTemplate(template);

    const componentKeys = this.readComponents(template).map((c) => c.key);

    // Allocation « à blanc » AVANT de créer quoi que ce soit : si la plage est
    // épuisée, autant échouer sans avoir démarré un labo qui serait de toute
    // façon inatteignable. Le résultat est jeté — seule compte l'exception.
    this.allocateIngress(labId, componentKeys);

    this.logger.log(`Création du labo ${labId} (template ${template})`);
    try {
      await this.runtime.create(labId, tpl);
    } catch (err) {
      this.logger.error(
        `Création du labo ${labId} échouée, nettoyage avant de propager`,
      );
      await this.runtime.delete(labId).catch(() => undefined);
      throw err;
    }

    // Allocation définitive seulement maintenant : la création a pu durer et un
    // autre labo a pu s'enregistrer entre-temps. Réallouer ici ferme la fenêtre
    // où deux labos concurrents recevraient les mêmes points d'exposition — ce
    // qui est sans coût, l'exposition n'étant pas figée dans le conteneur.
    const fresh = this.readState();
    fresh[labId] = {
      template,
      createdAt: new Date().toISOString(),
      ingress: this.allocateIngress(labId, componentKeys, fresh),
    };
    this.writeState(fresh);

    return this.getStatus(labId);
  }

  async start(labId: string): Promise<LabStatusDto> {
    this.requireTemplate(labId);
    await this.runtime.start(labId);
    return this.getStatus(labId);
  }

  async stop(labId: string): Promise<LabStatusDto> {
    this.requireTemplate(labId);
    await this.runtime.stop(labId);
    return this.getStatus(labId);
  }

  async pause(labId: string): Promise<LabStatusDto> {
    this.requireTemplate(labId);
    await this.runtime.pause(labId);
    return this.getStatus(labId);
  }

  async resume(labId: string): Promise<LabStatusDto> {
    this.requireTemplate(labId);
    await this.runtime.resume(labId);
    return this.getStatus(labId);
  }

  async delete(labId: string): Promise<void> {
    const state = this.readState();
    if (!state[labId]) return;
    await this.runtime.delete(labId);
    delete state[labId];
    this.writeState(state);
    this.logger.log(`Labo ${labId} supprimé`);
  }

  async getStatus(labId: string): Promise<LabStatusDto> {
    const entry = this.readState()[labId];
    if (!entry) {
      return { labId, exists: false, status: 'ABSENT', services: [] };
    }

    // Consulter un labo vaut signe de vie : c'est ce qui empêche le reaper de
    // faucher un labo activement utilisé (cf. LabsReaperService).
    this.touchLastSeen(labId);

    const tpl = this.readTemplate(entry.template);
    const components = this.readComponents(entry.template);
    const { instance, components: live } = await this.runtime.inspect(
      labId,
      tpl,
    );

    // Instance disparue alors que l'état existe : anomalie -> ERROR (pas
    // ABSENT), pour ne pas déclencher le nettoyage silencieux de la ligne Lab
    // côté portail sur un incident plutôt qu'un arrêt normal.
    if (instance === 'absent') {
      return {
        labId,
        exists: true,
        status: 'ERROR',
        services: components.map((c) =>
          this.componentStatus(c, 'absent', entry.ingress),
        ),
      };
    }

    const byService = new Map(live.map((c) => [c.service, c.state]));
    const services: LabServiceStatus[] = components.map((c) =>
      this.componentStatus(
        c,
        byService.get(c.service) ?? 'absent',
        entry.ingress,
      ),
    );

    return {
      labId,
      exists: true,
      status: this.computeAggregateStatus(instance, live),
      services,
    };
  }

  /**
   * Ensemble des routes que le rôle `gateway` doit servir, tous labos
   * confondus. Il les relit périodiquement pour ouvrir/fermer ses points
   * d'entrée au fil des créations et suppressions de labos.
   */
  listIngressRoutes(): IngressRoute[] {
    const routes: IngressRoute[] = [];
    for (const [labId, entry] of Object.entries(this.readState())) {
      if (!entry.ingress) continue;
      const components = this.readComponents(entry.template);
      for (const [key, binding] of Object.entries(entry.ingress.bindings)) {
        const component = components.find((c) => c.key === key);
        // Composant disparu du catalogue depuis l'allocation : on n'ouvre pas
        // de point d'entrée vers une cible inconnue.
        if (!component) continue;
        routes.push({
          labId,
          component: key,
          binding,
          // `<labId>` est résolu par le DNS Docker du réseau des labos.
          target: { host: labId, port: component.port },
        });
      }
    }
    return routes;
  }

  /**
   * Alloue les points d'exposition d'un labo en tenant compte de ceux déjà
   * pris par les autres. `state` permet d'imposer un instantané précis (cf.
   * la réallocation juste avant écriture dans `doCreate`).
   */
  private allocateIngress(
    labId: string,
    componentKeys: string[],
    state: LabsState = this.readState(),
  ): IngressAllocation {
    const taken = Object.entries(state)
      .filter(([id]) => id !== labId)
      .map(([, entry]) => entry.ingress)
      .filter((a): a is IngressAllocation => a !== undefined);
    return this.ingress.allocate(labId, componentKeys, taken);
  }

  private componentStatus(
    component: LabComponent,
    state: string,
    ingress: IngressAllocation | undefined,
  ): LabServiceStatus {
    // L'URL vient de la stratégie d'ingress, jamais d'un schéma en dur : c'est
    // ce qui permet de passer des ports aux noms d'hôte sans que le portail
    // (qui ne fait que relayer cette valeur) ait quoi que ce soit à changer.
    const binding = ingress?.bindings[component.key];
    return {
      name: component.key,
      state,
      running: state === 'running',
      url: binding
        ? `${this.ingress.urlFor(binding)}${component.path ?? ''}`
        : '',
    };
  }

  private computeAggregateStatus(
    instance: LabInstanceState,
    components: LabComponentState[],
  ): LabAggregateStatus {
    if (instance === 'paused') return 'PAUSED';
    if (instance === 'exited') return 'STOPPED';
    // instance === 'running'
    if (components.length === 0) return 'STARTING'; // démarrage en cours (démon du labo pas prêt)
    if (components.some((c) => c.state === 'dead')) return 'ERROR';
    if (components.every((c) => c.state === 'paused')) return 'PAUSED';
    if (components.every((c) => c.state === 'running')) return 'RUNNING';
    if (components.every((c) => c.state === 'exited' || c.state === 'created'))
      return 'STOPPED';
    // Mélange d'états, transitoire (juste après le boot / un restart).
    return 'STARTING';
  }

  private requireTemplate(labId: string): string {
    const entry = this.readState()[labId];
    if (!entry) throw new NotFoundException(`Labo ${labId} introuvable`);
    return entry.template;
  }

  /**
   * Métadonnées du template d'un labo existant — utilisé par le reaper, qui a
   * besoin d'inspecter un labo sans passer par `getStatus` (lequel
   * rafraîchirait `lastSeenAt` et empêcherait donc tout nettoyage).
   */
  templateFor(labId: string): LabTemplate {
    return this.readTemplate(this.requireTemplate(labId));
  }

  private assertSafeId(value: string, field: string): void {
    if (!SAFE_ID.test(value)) {
      throw new BadRequestException(
        `${field} invalide : uniquement [a-z0-9-], doit commencer par une lettre ou un chiffre`,
      );
    }
  }

  private readTemplate(template: string): LabTemplate {
    const path = join(this.templatesDir, template, 'lab-template.json');
    if (!existsSync(path)) {
      throw new BadRequestException(`Template inconnu : ${template}`);
    }
    return JSON.parse(readFileSync(path, 'utf-8')) as LabTemplate;
  }

  private readComponents(template: string): LabComponent[] {
    const path = join(this.templatesDir, template, 'lab-components.json');
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, 'utf-8')) as LabComponent[];
  }

  /**
   * Marque le labo comme vu à l'instant, en limitant la fréquence d'écriture
   * (cf. LAST_SEEN_THROTTLE_MS). Best-effort : une écriture d'état ratée ne
   * doit jamais faire échouer la consultation d'un labo — au pire le reaper
   * s'appuiera sur un horodatage légèrement plus ancien.
   */
  private touchLastSeen(labId: string): void {
    try {
      const state = this.readState();
      const entry = state[labId];
      if (!entry) return;

      const previous = Date.parse(entry.lastSeenAt ?? entry.createdAt);
      if (
        Number.isFinite(previous) &&
        Date.now() - previous < LAST_SEEN_THROTTLE_MS
      ) {
        return;
      }

      entry.lastSeenAt = new Date().toISOString();
      this.writeState(state);
    } catch (err) {
      this.logger.warn(
        `Impossible de rafraîchir lastSeenAt pour ${labId} : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Lecture de l'état complet — utilisée par le reaper. */
  readAllState(): LabsState {
    return this.readState();
  }

  private readState(): LabsState {
    if (!existsSync(this.stateFile)) return {};
    return JSON.parse(readFileSync(this.stateFile, 'utf-8')) as LabsState;
  }

  private writeState(state: LabsState): void {
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }
}
