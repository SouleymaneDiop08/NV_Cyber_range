import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ServiceTokenGuard } from './common/guards/service-token.guard';
import { LabsModule } from './labs/labs.module';
import { OrchestratorMode, servesControlApi } from './orchestrator-mode';

@Module({})
export class AppModule {
  static register(mode: OrchestratorMode): DynamicModule {
    const withControlApi = servesControlApi(mode);
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        LabsModule.register(withControlApi),
      ],
      // Le garde de token n'a de sens que là où l'API de contrôle est exposée.
      // En mode `gateway`, ne pas l'enregistrer signifie aussi que ce processus
      // n'a jamais besoin de connaître ORCHESTRATOR_SERVICE_TOKEN.
      providers: withControlApi
        ? [{ provide: APP_GUARD, useClass: ServiceTokenGuard }]
        : [],
    };
  }
}
