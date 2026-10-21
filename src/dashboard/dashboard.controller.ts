import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('exchange-rates')
  getExchangeRates() {
    return this.dashboardService.getExchangeRates();
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  getStats(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboardService.getStats(req.user, from, to);
  }

  @UseGuards(JwtAuthGuard)
  @Get('alerts')
  getAlerts() {
    return this.dashboardService.getAlerts();
  }

  @UseGuards(JwtAuthGuard)
  @Post('alerts/dismiss')
  dismissAlert(@Req() req: any, @Body() body: any) {
    return this.dashboardService.dismissAlert(
      req.user.id,
      String(body.key || ''),
      body?.password,
      {
        code: body.code,
        type: body.type,
        message: body.message,
        metadata: body.metadata,
      },
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('alerts/bulk-dismiss')
  bulkDismissAlerts(@Req() req: any, @Body() body: any) {
    if (!Array.isArray(body.alerts) || !body.alerts.length) {
      throw new UnauthorizedException('Aucune alerte selectionnee.');
    }
    return this.dashboardService.bulkDismissAlerts(
      req.user.id,
      body.alerts,
      body?.password,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Get('alerts/removed')
  getDismissedAlerts(@Query('code') code?: string) {
    return this.dashboardService.getDismissedAlerts(code);
  }

  @UseGuards(JwtAuthGuard)
  @Get('alerts/dismissed-keys')
  getDismissedKeys() {
    return this.dashboardService.getDismissedKeys();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Patch('alerts/restore/:id')
  restoreAlert(@Param('id') id: string) {
    return this.dashboardService.restoreAlert(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Delete('alerts/permanent/:id')
  async permanentDeleteAlert(
    @Req() req: any,
    @Param('id') id: string,
    @Body('password') password?: string,
    @Query('password') qPassword?: string,
  ) {
    const pwd = password || qPassword;
    await this.dashboardService.verifyPassword(req.user.id, pwd);
    return this.dashboardService.permanentDeleteAlert(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Post('alerts/bulk-restore')
  bulkRestoreAlerts(@Body() body: { ids: string[] }) {
    return this.dashboardService.bulkRestoreAlerts(body.ids);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Post('alerts/bulk-permanent-delete')
  async bulkPermanentDeleteAlerts(
    @Req() req: any,
    @Body() body: { ids: string[]; password?: string },
  ) {
    await this.dashboardService.verifyPassword(req.user.id, body.password);
    return this.dashboardService.bulkPermanentDeleteAlerts(body.ids);
  }
}
