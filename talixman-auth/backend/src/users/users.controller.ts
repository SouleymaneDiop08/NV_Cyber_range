import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditAction } from '../common/decorators/audit-action.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { SessionData } from '../auth/services/session.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

@Roles('SUPERADMIN', 'ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @AuditAction('USER_CREATE')
  create(@CurrentUser() actor: SessionData, @Body() dto: CreateUserDto) {
    return this.usersService.createInvitedUser(actor, dto);
  }

  // Routes `me/*` : tout dérive de la session, aucun identifiant de portée
  // n'est accepté du client — même principe que `/labs/me*`, aucune surface
  // IDOR. Déclarées avant les routes paramétrées pour rester lisibles.
  @Get('me/guests')
  listOwnGuests(@CurrentUser() actor: SessionData) {
    return this.usersService.listOwnGuests(actor);
  }

  @Delete('me/guests/:id')
  @AuditAction('USER_DELETE')
  removeOwnGuest(@CurrentUser() actor: SessionData, @Param('id') id: string) {
    return this.usersService.removeOwnGuest(actor, id);
  }

  @Roles('SUPERADMIN')
  @Get()
  list(@Query('role') role?: Role) {
    return this.usersService.list(role);
  }

  @Roles('SUPERADMIN')
  @Delete(':id')
  @AuditAction('USER_DELETE')
  remove(@CurrentUser() actor: SessionData, @Param('id') id: string) {
    return this.usersService.remove(actor, id);
  }
}
