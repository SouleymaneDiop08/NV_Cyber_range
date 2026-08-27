import { Module } from '@nestjs/common';
import { SectorsController } from './sectors.controller';

@Module({
  controllers: [SectorsController],
})
export class SectorsModule {}
