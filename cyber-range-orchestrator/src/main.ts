import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LabPortProxy } from './gateway/port-proxy';
import { LabsService } from './labs/labs.service';
import { resolveOrchestratorMode, servesGateway } from './orchestrator-mode';

async function bootstrap() {
  // Rôle de ce processus : `control` (API de pilotage, socket Docker monté) ou
  // `gateway` (points d'entrée publics, aucun socket Docker), cf.
  // orchestrator-mode.ts. `all` reste le défaut pour le développement.
  const mode = resolveOrchestratorMode(process.env.ORCHESTRATOR_MODE);
  const app = await NestFactory.create(AppModule.register(mode));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const logger = new Logger('Bootstrap');

  if (servesGateway(mode)) {
    // Un point d'entrée par composant de labo, en dehors du serveur Nest :
    // chaque application du laboratoire doit se voir à la RACINE de sa propre
    // origine (cf. gateway/port-proxy.ts). La résolution des routes est
    // déléguée à LabsService — la gateway ne détient aucun schéma d'URL.
    const labsService = app.get(LabsService);
    new LabPortProxy(
      () => labsService.listIngressRoutes(),
      Number(process.env.GATEWAY_SYNC_INTERVAL_MS ?? 5000),
    ).start();
    logger.log('Points d’entrée des labos activés');
  }

  const port = process.env.PORT ?? 4100;
  await app.listen(port);
  logger.log(
    `cyber-range-orchestrator démarré en mode « ${mode} » sur le port ${port}`,
  );
}
bootstrap();
