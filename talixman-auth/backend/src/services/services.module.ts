import { Module } from '@nestjs/common';
import { LabsModule } from '../labs/labs.module';
import { LabComponentsController } from './lab-components.controller';
import { MeController } from './me.controller';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [LabsModule],
  controllers: [ServicesController, LabComponentsController, MeController],
  providers: [ServicesService],
})
export class ServicesModule {}
