import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LotContratService } from './lot-contrat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('lot-contrats')
export class LotContratController {
  constructor(private readonly lotContratService: LotContratService) {}

  @Get()
  findAll(
    @Query('agenceId') agenceId?: string,
    @Query('status') status?: string,
  ) {
    return this.lotContratService.findAll({ agenceId, status });
  }

  @Get('active')
  getActive(@Query('agenceId') agenceId?: string) {
    if (agenceId) {
      return this.lotContratService.getActiveByAgence(agenceId);
    }
    return this.lotContratService.getAllActive();
  }

  @Get('next-number')
  getNextNumber(@Query('agenceId') agenceId?: string) {
    return this.lotContratService.getNextAvailableNumber(agenceId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.lotContratService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @Post()
  create(@Body() body: any) {
    return this.lotContratService.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.lotContratService.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.lotContratService.closeLot(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Patch(':id/reopen')
  reopen(
    @Param('id') id: string,
    @Body('closeOther') closeOther?: boolean,
  ) {
    return this.lotContratService.reopenLot(id, closeOther);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @Post(':id/recalculate-current-number')
  recalculateCurrentNumber(@Param('id') id: string) {
    return this.lotContratService.recalculateCurrentNumber(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.lotContratService.remove(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Post('cleanup-out-of-range')
  cleanupOutOfRange() {
    return this.lotContratService.cleanupOutOfRangeContrats();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Post(':id/attach-contrat')
  attachContrat(
    @Param('id') lotId: string,
    @Body() body: { contratId?: string; contratIds?: string[] },
  ) {
    if (body.contratIds && Array.isArray(body.contratIds)) {
      return this.lotContratService.attachMultipleContrats(lotId, body.contratIds);
    }
    return this.lotContratService.attachExistingContrat(lotId, body.contratId!);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Post(':id/detach-contrat')
  detachContrat(
    @Param('id') lotId: string,
    @Body('contratId') contratId: string,
  ) {
    return this.lotContratService.detachContrat(lotId, contratId);
  }
}
