import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SettingService } from './setting.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Get()
  @Roles('admin')
  getSettings() {
    return this.settingService.getSettings();
  }

  @Patch()
  @Roles('admin')
  updateSettings(@Body() data: any) {
    return this.settingService.updateSettings(data);
  }
}
