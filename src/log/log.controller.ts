import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LogService } from './log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('logs')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('name') name?: string,
    @Query('actorId') actorId?: string,
    @Query('role') role?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.logService.findAll({ search, name, actorId, role, from, to });
  }
}
