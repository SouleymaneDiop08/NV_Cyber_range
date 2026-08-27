import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LabsController } from './labs.controller';
import { LabsReaperService } from './labs-reaper.service';
import { LabsService } from './labs.service';
import { TemplatesController } from './templates.controller';
import { DindComposeDriver } from './runtime/dind-compose.driver';
import { KataComposeDriver } from './runtime/kata-compose.driver';
import { LAB_RUNTIME_DRIVER } from './runtime/lab-runtime.tokens';
import { PortIngress } from '../ingress/port-ingress';
import { LAB_INGRESS } from '../ingress/ingress.tokens';

@Module({})
export class LabsModule {
  /**
   * `withControlApi` conditionne l'exposition de l'API de contrôle
   * (`/labs/*`, `/templates/*`). En mode `gateway`, le processus n'a besoin
   * que de `LabsService` — pour résoudre les cibles de proxy depuis l'état des
   * labos — et surtout ne doit PAS exposer de route capable de piloter Docker
   * (cf. orchestrator-mode.ts).
   */
  static register(withControlApi: boolean): DynamicModule {
    return {
      module: LabsModule,
      // Le planificateur n'est utile qu'au reaper, donc qu'en mode `control`.
      imports: withControlApi ? [ScheduleModule.forRoot()] : [],
      controllers: withControlApi ? [LabsController, TemplatesController] : [],
      providers: [
        LabsService,
        DindComposeDriver,
        KataComposeDriver,
        PortIngress,
        {
          // Stratégie d'exposition publique. `port` en v1 (une origine par
          // composant) ; un futur `hostname` se branchera ici sans toucher à
          // LabsService, au portail ni aux services du laboratoire.
          provide: LAB_INGRESS,
          useExisting: PortIngress,
        },
        // Nettoyage des labos inactifs : pilote Docker, donc réservé au rôle
        // qui détient le socket (cf. orchestrator-mode.ts).
        ...(withControlApi ? [LabsReaperService] : []),
        {
          // Runtime concret choisi par configuration, jamais en dur : `dind`
          // est le runtime de la v1, `kata` reste branché tel quel pour la
          // cible long terme (il exige KVM et le runtime Kata enregistré côté
          // hôte). Ce point d'injection unique garantit qu'ajouter ou
          // remplacer un runtime ne touche ni LabsService, ni le portail, ni
          // le frontend.
          provide: LAB_RUNTIME_DRIVER,
          inject: [ConfigService, DindComposeDriver, KataComposeDriver],
          useFactory: (
            config: ConfigService,
            dind: DindComposeDriver,
            kata: KataComposeDriver,
          ) =>
            config.get<string>('LAB_RUNTIME', 'dind') === 'kata' ? kata : dind,
        },
      ],
      // Exporté pour que la gateway HTTP (main.ts) résolve ses cibles de proxy.
      exports: [LabsService],
    };
  }
}
