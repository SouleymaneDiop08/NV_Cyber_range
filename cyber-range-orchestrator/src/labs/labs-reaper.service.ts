import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { LabsService } from './labs.service';
import type { LabRuntimeDriver } from './runtime/lab-runtime.driver';
import { LAB_RUNTIME_DRIVER } from './runtime/lab-runtime.tokens';

/**
 * Nettoyage automatique des laboratoires inactifs. Sans lui, un labo démarré
 * reste indéfiniment en vie : sur un cyber range où chaque labo est un démon
 * Docker avec une dizaine de conteneurs, quelques oublis suffisent à saturer
 * l'hôte.
 *
 * Deux paliers, volontairement distincts :
 * 1. `stop` après `LAB_IDLE_STOP_MINUTES` — libère CPU et RAM, mais l'état du
 *    labo est conservé et l'utilisateur peut le relancer d'un clic.
 * 2. `delete` après `LAB_IDLE_DESTROY_HOURS` — libère aussi le disque. Le
 *    portail détecte l'absence au sondage suivant et nettoie sa ligne `Lab`.
 *
 * Le compteur d'inactivité est `lastSeenAt`, rafraîchi par `LabsService` à
 * chaque consultation d'état : un labo affiché dans le portail n'est donc
 * jamais fauché, même sans interaction de l'utilisateur.
 *
 * N'est enregistré qu'en mode `control` (cf. LabsModule) : c'est le seul rôle
 * qui pilote Docker.
 */
@Injectable()
export class LabsReaperService {
  private readonly logger = new Logger(LabsReaperService.name);

  private readonly enabled: boolean;
  private readonly idleStopMs: number;
  private readonly idleDestroyMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly labs: LabsService,
    @Inject(LAB_RUNTIME_DRIVER)
    private readonly runtime: LabRuntimeDriver,
  ) {
    this.enabled =
      this.config.get<string>('LAB_REAPER_ENABLED', 'true') !== 'false';
    this.idleStopMs =
      Number(this.config.get<string>('LAB_IDLE_STOP_MINUTES', '60')) * 60_000;
    this.idleDestroyMs =
      Number(this.config.get<string>('LAB_IDLE_DESTROY_HOURS', '24')) *
      3_600_000;
  }

  /**
   * Intervalle fixe plutôt qu'un cron : la granularité utile se compte en
   * minutes, et un intervalle reste lisible sans connaître la syntaxe cron.
   */
  @Interval('lab-reaper', 5 * 60_000)
  async sweep(): Promise<void> {
    if (!this.enabled) return;

    const state = this.labs.readAllState();
    const now = Date.now();

    for (const [labId, entry] of Object.entries(state)) {
      const reference = Date.parse(entry.lastSeenAt ?? entry.createdAt);
      if (!Number.isFinite(reference)) continue;
      const idleMs = now - reference;

      try {
        if (idleMs >= this.idleDestroyMs) {
          this.logger.log(
            `Labo ${labId} supprimé : inactif depuis ${this.humanize(idleMs)} ` +
              `(seuil de destruction ${this.humanize(this.idleDestroyMs)})`,
          );
          await this.labs.delete(labId);
          continue;
        }

        if (idleMs >= this.idleStopMs) {
          // `stop` seulement si l'instance tourne encore : sans ce test, un
          // labo déjà arrêté serait « arrêté » à chaque passage, et le journal
          // se remplirait d'actions sans effet.
          const { instance } = await this.runtime.inspect(
            labId,
            this.templateOf(labId),
          );
          if (instance !== 'running') continue;

          this.logger.log(
            `Labo ${labId} arrêté : inactif depuis ${this.humanize(idleMs)} ` +
              `(seuil d'arrêt ${this.humanize(this.idleStopMs)})`,
          );
          await this.labs.stop(labId);
        }
      } catch (err) {
        // Un labo qui résiste ne doit pas empêcher de traiter les suivants.
        this.logger.error(
          `Nettoyage du labo ${labId} échoué : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private templateOf(labId: string) {
    return this.labs.templateFor(labId);
  }

  private humanize(ms: number): string {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
}
