import { Controller, Get, Param } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { ServicesService } from './services.service';

/**
 * Catalogue des composants K8s valides pour le template du secteur — alimente
 * le menu déroulant SUPERADMIN dans GestionPage (remplace l'ancienne URL de
 * lancement statique). Contrôleur séparé de `ServicesController` : chemin
 * frère (`sectors/:sectorId/lab-components`), pas imbriqué sous `/services`.
 */
@Roles('SUPERADMIN')
@Controller('sectors/:sectorId/lab-components')
export class LabComponentsController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  list(@Param('sectorId') sectorId: string) {
    return this.servicesService.listLabComponents(sectorId);
  }
}
