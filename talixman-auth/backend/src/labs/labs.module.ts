import { Module } from '@nestjs/common';
import { LabsController } from './labs.controller';
import { LabTokenService } from './lab-token.service';
import { LabsService } from './labs.service';
import { OrchestratorClientService } from './orchestrator-client.service';

@Module({
  controllers: [LabsController],
  providers: [LabsService, OrchestratorClientService, LabTokenService],
  exports: [LabsService, OrchestratorClientService, LabTokenService],
})
export class LabsModule {}
