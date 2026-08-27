import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  IngressAllocation,
  IngressBinding,
  IngressBindings,
  LabIngress,
} from './lab-ingress';

/**
 * Stratégie « une origine = un port » — celle de la v1.
 *
 * Chaque composant d'un labo reçoit un port dédié, publié par la gateway et
 * proxifié vers `http://<labId>:<port interne>`. L'application se voit donc à
 * la racine d'une origine à elle : ses `<base href="/">`, ses redirections
 * `Location: /login`, ses appels `/api/...` et ses WebSockets fonctionnent
 * sans qu'on touche à une seule ligne du laboratoire.
 *
 * Les labos, eux, ne publient toujours AUCUN port : c'est la gateway qui
 * détient l'entrée, donc le trafic reste soumis au middleware et la bascule
 * ultérieure vers un routage par nom d'hôte n'aura rien à changer côté labo.
 */
@Injectable()
export class PortIngress implements LabIngress {
  readonly strategy = 'port';

  private readonly logger = new Logger(PortIngress.name);
  private readonly min: number;
  private readonly max: number;
  private readonly publicHost: string;

  constructor(config: ConfigService) {
    this.min = Number(config.get<string>('LAB_INGRESS_PORT_MIN', '20000'));
    this.max = Number(config.get<string>('LAB_INGRESS_PORT_MAX', '20099'));
    // Hôte par lequel un NAVIGATEUR joint la gateway — jamais `localhost`, qui
    // désignerait le poste client. Même contrainte que GATEWAY_PUBLIC_URL.
    this.publicHost = config
      .getOrThrow<string>('GATEWAY_PUBLIC_HOST')
      .replace(/\/+$/, '');
  }

  allocate(
    labId: string,
    componentKeys: string[],
    taken: IngressAllocation[],
  ): IngressAllocation {
    const used = new Set<number>();
    for (const allocation of taken) {
      for (const binding of Object.values(allocation.bindings)) {
        if (binding.port !== undefined) used.add(binding.port);
      }
    }

    const bindings: IngressBindings = {};
    let next = this.min;
    for (const key of componentKeys) {
      while (used.has(next)) next++;
      if (next > this.max) {
        // Plutôt que d'exposer un labo à moitié : on échoue explicitement, et
        // LabsService nettoie ce qu'il a déjà créé.
        throw new InternalServerErrorException(
          `Plus de port d'exposition disponible (plage ${this.min}-${this.max}). ` +
            `Élargir LAB_INGRESS_PORT_MIN/MAX et la plage publiée par la gateway.`,
        );
      }
      bindings[key] = { port: next };
      used.add(next);
      next++;
    }

    this.logger.log(
      `Labo ${labId} : ${componentKeys.length} ports d'exposition alloués ` +
        `(${Object.values(bindings)[0]?.port}-${next - 1})`,
    );
    return { strategy: this.strategy, bindings };
  }

  urlFor(binding: IngressBinding): string {
    return `http://${this.publicHost}:${binding.port}`;
  }
}
