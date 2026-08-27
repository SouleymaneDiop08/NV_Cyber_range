import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
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
 * Driver « une mini-VM Kata par labo ». Chaque labo est UN conteneur OCI lancé
 * sous le runtime Kata (`--runtime io.containerd.kata.v2`) : Kata en fait une
 * micro-VM matérielle. L'image de ce conteneur est l'appliance du template
 * (dockerd + docker compose du labo, cf. dispatching/appliance/) — le compose
 * s'exécute DANS la VM. On abandonne ainsi le Docker-in-Docker `--privileged`
 * sur le noyau de l'hôte : l'isolation vient de la frontière VM de Kata.
 *
 * Conséquence directe : les réseaux L1/L2/L3 et les IP statiques du labo vivent
 * dans la VM, donc N labos peuvent réutiliser exactement les mêmes adresses
 * sans collision d'IPAM — sans aucun daemon Docker imbriqué à piloter à la main.
 *
 * Le middleware ne pilote QUE le cycle de vie de la VM (run/start/stop/pause/
 * unpause/rm) sur le daemon de l'hôte, plus une lecture `docker exec <labId>
 * docker compose ps` pour l'état fin des composants.
 */
@Injectable()
export class KataComposeDriver implements LabRuntimeDriver {
  private readonly logger = new Logger(KataComposeDriver.name);

  /** Runtime OCI Kata. Overridable pour tester avec `runc` sur une machine sans KVM. */
  private readonly kataRuntime: string;

  /**
   * Réseau Docker partagé de talixman-auth : la VM du labo y est attachée sous
   * le nom `<labId>`, ce qui la rend résolvable par la gateway HTTP de ce
   * service (cf. gateway/port-proxy.ts, cible http://<labId>:<port>). Les
   * ports des composants sont publiés par le reverse_proxy DANS la VM (cf.
   * dispatching/docker-compose.yml) -> exposés sur l'interface de la VM.
   */
  private readonly gatewayNetwork: string;

  constructor(config: ConfigService) {
    this.kataRuntime = config.get<string>(
      'KATA_RUNTIME',
      'io.containerd.kata.v2',
    );
    this.gatewayNetwork = config.get<string>(
      'GATEWAY_NETWORK',
      'talixman-auth_default',
    );
  }

  async create(labId: string, template: LabTemplate): Promise<void> {
    // `--privileged` est nécessaire au dockerd interne de l'appliance, mais il
    // est CONFINÉ à la VM Kata (config Kata `privileged_without_host_devices`)
    // — contrairement au DinD `--privileged` d'avant, il ne donne aucun accès
    // privilégié au noyau de l'hôte.
    await this.runHost([
      'run',
      '-d',
      '--name',
      labId,
      '--runtime',
      this.kataRuntime,
      '--network',
      this.gatewayNetwork,
      '--label',
      `talixman.lab=${labId}`,
      '--privileged',
      '-e',
      `COMPOSE_PROFILES=${template.composeProfile}`,
      template.labImage,
    ]);
  }

  async start(labId: string): Promise<void> {
    await this.runHost(['start', labId]);
  }

  async stop(labId: string): Promise<void> {
    await this.runHost(['stop', labId]);
  }

  async pause(labId: string): Promise<void> {
    await this.runHost(['pause', labId]);
  }

  async resume(labId: string): Promise<void> {
    await this.runHost(['unpause', labId]);
  }

  async delete(labId: string): Promise<void> {
    // best-effort/idempotent : un labo déjà disparu ne doit pas faire échouer
    // la suppression côté portail. `-v` retire les volumes anonymes créés par
    // les `VOLUME` de l'image dind embarquée dans l'appliance — sans lui,
    // chaque suppression laisserait plusieurs Go derrière elle.
    await this.runHost(['rm', '-f', '-v', labId]).catch(() => undefined);
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
    const instance = await this.vmState(labId);
    if (instance !== 'running') {
      return { instance, components: [] };
    }
    // VM up : on interroge le compose DANS la VM. Si le dockerd interne n'est
    // pas encore prêt (boot en cours), l'exec échoue -> composants vides, que
    // LabsService interprète comme STARTING.
    const components = await this.composeComponents(labId, template).catch(
      () => [] as LabComponentState[],
    );
    return { instance, components };
  }

  /** État de la VM elle-même via `docker inspect` (status + drapeau paused). */
  private async vmState(labId: string): Promise<LabInstanceState> {
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
   * dans l'appliance — on gère les deux.
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

  private async runHost(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('docker', args, {
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`docker ${args.join(' ')} a échoué : ${message}`);
      throw new InternalServerErrorException(
        'Commande Docker (runtime Kata) échouée pour un labo.',
      );
    }
  }
}
