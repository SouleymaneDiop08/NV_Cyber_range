import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import {
  LabComponentState,
  LabInspection,
  LabInstanceState,
  LabRuntimeDriver,
  LabTemplate,
} from './lab-runtime.driver';

const execFileAsync = promisify(execFile);

/**
 * Driver « un conteneur Docker-in-Docker par labo » — runtime de la v1.
 *
 * Chaque labo est UN conteneur exécutant son propre démon Docker (image de labo
 * auto-suffisante, cf. dispatching/lab-image/), qui lance à son tour le
 * `docker compose` du laboratoire. Conséquence directe : les réseaux L1/L2/L3
 * et les IP statiques du labo vivent dans la pile réseau de ce conteneur, donc
 * N labos réutilisent exactement les mêmes adresses sans collision d'IPAM, et
 * le compose du laboratoire tourne tel quel, topologie inchangée.
 *
 * Le middleware ne pilote QUE le cycle de vie du conteneur (run/start/stop/
 * pause/unpause/rm) sur le démon de l'hôte, plus une lecture
 * `docker exec <labId> docker compose ps` pour l'état fin des composants. Il
 * n'entre jamais dans le labo autrement.
 *
 * Durcissement appliqué ici (cf. plan de migration) :
 * - image de base rootless par défaut : le démon interne tourne sous un
 *   utilisateur non privilégié dans un user namespace, donc une évasion depuis
 *   le labo retombe sur un UID non privilégié de l'hôte, pas sur root ;
 * - réseau dédié et `internal`, sans aucun service du portail dessus, et aucun
 *   port publié sur l'hôte : les composants ne sont joignables que par la
 *   gateway du middleware ;
 * - aucun socket Docker de l'hôte monté dans le labo — le démon du labo est le
 *   sien ;
 * - quotas mémoire / CPU / PIDs et journalisation bornée, pour qu'un labo ne
 *   puisse pas épuiser l'hôte ;
 * - volume nommé et labellisé par labo, supprimé avec lui (pas de fuite).
 *
 * Limite assumée : `cap_drop` et `no-new-privileges` sont sans effet sur ce
 * conteneur (le démon interne exige les privilèges de montage). Le confinement
 * fin s'applique aux conteneurs INTERNES du labo, à qui le démon du labo
 * n'accorde que `NET_ADMIN`/`NET_RAW` au-dessus du jeu par défaut, avec le
 * profil seccomp par défaut de Docker.
 */
@Injectable()
export class DindComposeDriver implements LabRuntimeDriver {
  private readonly logger = new Logger(DindComposeDriver.name);

  /**
   * Réseau Docker dédié aux labos. Le conteneur du labo y est attaché sous le
   * nom `<labId>`, ce qui le rend résolvable par la gateway HTTP de ce service
   * (cf. gateway/port-proxy.ts, cible http://<labId>:<port>). Ce réseau est
   * déclaré `internal` et ne porte AUCUN service du portail (Postgres, Redis,
   * Keycloak) — c'est ce qui isole les labos des données de la plateforme.
   */
  private readonly labsNetwork: string;

  /**
   * Répertoire de données du démon interne, à couvrir par un volume dédié :
   * sans lui le démon retombe sur le driver de stockage `vfs` (lent et
   * gourmand) faute de pouvoir empiler overlayfs sur overlayfs.
   * Rootless : `/home/rootless/.local/share/docker`. Root : `/var/lib/docker`.
   */
  private readonly dataDir: string;

  /**
   * `--privileged` reste nécessaire au démon interne (montages, cgroups) même
   * en rootless, où il est toutefois bien moins grave : les privilèges
   * s'exercent dans le user namespace de l'utilisateur non privilégié du labo.
   * Passable à `false` pour tester un confinement plus strict.
   */
  private readonly privileged: boolean;

  private readonly memory: string;
  private readonly cpus: string;
  private readonly pidsLimit: string;
  private readonly logMaxSize: string;
  private readonly logMaxFile: string;

  /**
   * Clé maîtresse du lancement authentifié des composants.
   *
   * Elle ne descend JAMAIS dans un labo : seul le secret dérivé pour ce labo
   * précis y est injecté. Le portail applique exactement la même dérivation de
   * son côté, ce qui évite de faire transiter le moindre secret entre les deux
   * services. Vide = fonctionnalité désactivée, sans secret de repli.
   */
  private readonly ssoMasterKey: Buffer;

  constructor(config: ConfigService) {
    this.labsNetwork = config.get<string>('LABS_NETWORK', 'talixman_labs');
    this.dataDir = config.get<string>(
      'LAB_DATA_DIR',
      '/home/rootless/.local/share/docker',
    );
    this.privileged = config.get<string>('LAB_PRIVILEGED', 'true') !== 'false';
    this.memory = config.get<string>('LAB_MEMORY', '6g');
    this.cpus = config.get<string>('LAB_CPUS', '4');
    this.pidsLimit = config.get<string>('LAB_PIDS_LIMIT', '4096');
    this.logMaxSize = config.get<string>('LAB_LOG_MAX_SIZE', '10m');
    this.logMaxFile = config.get<string>('LAB_LOG_MAX_FILE', '3');

    const master = config.get<string>('LAB_SSO_MASTER_KEY', '');
    this.ssoMasterKey = master ? Buffer.from(master, 'hex') : Buffer.alloc(0);
    // Le rôle `gateway` ne crée aucun labo : la clé y est volontairement vide,
    // il n'y a donc rien à signaler dans ce mode.
    const createsLabs = config.get<string>('ORCHESTRATOR_MODE') !== 'gateway';
    if (this.ssoMasterKey.length === 0) {
      if (createsLabs) {
        this.logger.warn(
          'LAB_SSO_MASTER_KEY absente — les composants des labos ne recevront pas de secret de lancement.',
        );
      }
    } else if (this.ssoMasterKey.length < 32) {
      throw new Error(
        'LAB_SSO_MASTER_KEY doit faire au moins 32 octets en hexadécimal (openssl rand -hex 32).',
      );
    }
  }

  /** Volume de données du démon interne, nommé et labellisé pour ce labo. */
  private volumeName(labId: string): string {
    return `lab-data-${labId}`;
  }

  /**
   * Secret propre à ce labo — dérivation strictement identique à celle du
   * portail (`LabTokenService.deriveLabSecret`). Les deux services partagent
   * la clé maîtresse, jamais les secrets dérivés.
   */
  private deriveLabSecret(labId: string): string {
    return createHmac('sha256', this.ssoMasterKey).update(labId).digest('hex');
  }

  async create(labId: string, template: LabTemplate): Promise<void> {
    // Volume créé explicitement (plutôt que laissé à l'auto-création par
    // `-v`) pour porter le label `talixman.lab` : c'est lui qui rend le
    // nettoyage des volumes orphelins fiable, y compris après un incident.
    await this.runHost([
      'volume',
      'create',
      '--label',
      `talixman.lab=${labId}`,
      this.volumeName(labId),
    ]);

    const args = [
      'run',
      '-d',
      '--name',
      labId,
      '--network',
      this.labsNetwork,
      '--label',
      `talixman.lab=${labId}`,
      // Le cycle de vie est piloté par le middleware, jamais par Docker : un
      // redémarrage automatique masquerait un labo en échec au lieu de le
      // remonter en ERROR.
      '--restart',
      'no',
      '-v',
      `${this.volumeName(labId)}:${this.dataDir}`,
      '--memory',
      this.memory,
      '--cpus',
      this.cpus,
      '--pids-limit',
      this.pidsLimit,
      '--log-driver',
      'json-file',
      '--log-opt',
      `max-size=${this.logMaxSize}`,
      '--log-opt',
      `max-file=${this.logMaxFile}`,
      '-e',
      `COMPOSE_PROFILES=${template.composeProfile}`,
    ];

    // Secret de lancement propre à ce labo. Le compose du laboratoire le relaie
    // aux composants qui en ont besoin ; il ne vaut que pour ce labo, et sa
    // lecture ne donne accès à aucun autre.
    if (this.ssoMasterKey.length > 0) {
      args.push('-e', `LAB_SSO_SECRET=${this.deriveLabSecret(labId)}`);
      args.push('-e', `LAB_ID=${labId}`);
    }

    if (this.privileged) {
      args.push('--privileged');
    } else {
      // Confinement plus strict, à valider labo par labo : le démon interne a
      // besoin des appels de montage, que les profils par défaut bloquent.
      args.push(
        '--security-opt',
        'seccomp=unconfined',
        '--security-opt',
        'apparmor=unconfined',
        '--device',
        '/dev/fuse',
      );
    }

    args.push(template.labImage);

    try {
      await this.runHost(args);
    } catch (err) {
      // Le conteneur n'a pas démarré : le volume qu'on vient de créer serait
      // orphelin. On le retire avant de propager.
      await this.removeVolume(labId);
      throw err;
    }
  }

  async start(labId: string): Promise<void> {
    await this.runHost(['start', labId]);
  }

  async stop(labId: string): Promise<void> {
    await this.runHost(['stop', labId]);
  }

  async pause(labId: string): Promise<void> {
    // Gèle le cgroup du conteneur ET ses cgroups imbriqués : tout le labo est
    // suspendu, pas seulement son démon.
    await this.runHost(['pause', labId]);
  }

  async resume(labId: string): Promise<void> {
    await this.runHost(['unpause', labId]);
  }

  async delete(labId: string): Promise<void> {
    // best-effort/idempotent : un labo déjà disparu ne doit pas faire échouer
    // la suppression côté portail.
    // `-v` retire les volumes ANONYMES (l'image de labo en déclare, cf. les
    // `VOLUME` de l'image dind) ; le volume NOMMÉ de données, lui, survit à
    // `docker rm` par conception et doit être supprimé explicitement. Sans ces
    // deux gestes, chaque labo supprimé laisserait plusieurs Go derrière lui.
    await this.runHost(['rm', '-f', '-v', labId]).catch(() => undefined);
    await this.removeVolume(labId);
  }

  private async removeVolume(labId: string): Promise<void> {
    await this.runHost(['volume', 'rm', '-f', this.volumeName(labId)]).catch(
      () => undefined,
    );
  }

  async exists(labId: string): Promise<boolean> {
    try {
      await execFileAsync('docker', ['inspect', '--type=container', labId]);
      return true;
    } catch {
      return false;
    }
  }

  async inspect(labId: string, template: LabTemplate): Promise<LabInspection> {
    const instance = await this.instanceState(labId);
    if (instance !== 'running') {
      return { instance, components: [] };
    }
    // Conteneur up : on interroge le compose DANS le labo. Si le démon interne
    // n'est pas encore prêt (démarrage en cours), l'exec échoue -> composants
    // vides, que LabsService interprète comme STARTING.
    const components = await this.composeComponents(labId, template).catch(
      () => [] as LabComponentState[],
    );
    return { instance, components };
  }

  /** État du conteneur du labo via `docker inspect` (status + drapeau paused). */
  private async instanceState(labId: string): Promise<LabInstanceState> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'inspect',
        labId,
        '--format',
        '{{.State.Status}}|{{.State.Paused}}',
      ]);
      const [status, paused] = stdout.trim().split('|');
      if (paused === 'true') return 'paused';
      if (status === 'running') return 'running';
      if (status === 'paused') return 'paused';
      // created | exited | dead | restarting -> considérés "arrêté" ici.
      return 'exited';
    } catch {
      return 'absent';
    }
  }

  private async composeComponents(
    labId: string,
    template: LabTemplate,
  ): Promise<LabComponentState[]> {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'exec',
        labId,
        'docker',
        'compose',
        '-f',
        template.composeFile,
        'ps',
        '--all',
        '--format',
        'json',
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return this.parseComposePs(stdout);
  }

  /**
   * `docker compose ps --format json` renvoie soit un tableau JSON, soit une
   * ligne JSON par conteneur (JSON Lines) selon la version du plugin embarquée
   * dans l'image de labo — on gère les deux.
   */
  private parseComposePs(raw: string): LabComponentState[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const toEntry = (o: { Service?: string; State?: string }) => ({
      service: o.Service ?? '',
      state: o.State ?? 'absent',
    });
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed))
        return (parsed as Array<{ Service?: string; State?: string }>).map(
          toEntry,
        );
      return [toEntry(parsed as { Service?: string; State?: string })];
    } catch {
      return trimmed
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) =>
          toEntry(JSON.parse(line) as { Service?: string; State?: string }),
        );
    }
  }

  /**
   * Masque la valeur des variables d'environnement avant journalisation.
   *
   * `docker run` reçoit le secret de lancement du labo en `-e` : sans ce
   * filtre, le moindre échec de commande l'écrirait en clair dans les
   * journaux, où il survivrait bien plus longtemps que dans le conteneur.
   */
  private static redact(args: string[]): string {
    return args
      .map((arg, i) =>
        i > 0 && args[i - 1] === '-e' && arg.includes('=')
          ? `${arg.slice(0, arg.indexOf('=') + 1)}***`
          : arg,
      )
      .join(' ');
  }

  private async runHost(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('docker', args, {
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `docker ${DindComposeDriver.redact(args)} a échoué : ${message}`,
      );
      throw new InternalServerErrorException(
        'Commande Docker (runtime DinD) échouée pour un labo.',
      );
    }
  }
}
