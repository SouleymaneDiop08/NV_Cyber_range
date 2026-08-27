import { Module } from '@nestjs/common';
import { LabsModule } from '../labs/labs.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [LabsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
