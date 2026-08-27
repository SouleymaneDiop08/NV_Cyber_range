import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AuditAction } from '../common/decorators/audit-action.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServicesService } from './services.service';

@Roles('SUPERADMIN')
@Controller('sectors/:sectorId/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  findAll(@Param('sectorId') sectorId: string) {
    return this.servicesService.findAllBySector(sectorId);
  }

  @Post()
  @AuditAction('SERVICE_CREATE')
  create(@Param('sectorId') sectorId: string, @Body() dto: CreateServiceDto) {
    return this.servicesService.create(sectorId, dto);
  }

  @Patch(':id')
  @AuditAction('SERVICE_UPDATE')
  update(
    @Param('sectorId') sectorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.servicesService.update(sectorId, id, dto);
  }

  @Delete(':id')
  @AuditAction('SERVICE_DELETE')
  remove(@Param('sectorId') sectorId: string, @Param('id') id: string) {
    return this.servicesService.remove(sectorId, id);
  }
}
