import { Controller, Get, Patch, Body, UseGuards, Req, ForbiddenException } from '@nestjs/common';
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
  async updateSettings(@Body() data: any, @Req() req: any) {
    if (Array.isArray(data?.depenseCategories)) {
      const current = (await this.settingService.getSettings()) as any;
      const existing: string[] = Array.isArray(current.depenseCategories)
        ? current.depenseCategories
        : [];
      const incoming: string[] = data.depenseCategories.map((c: any) =>
        String(c),
      );
      const removed = existing.some((c) => !incoming.includes(c));
      if (removed && req.user?.role !== 'super_admin') {
        throw new ForbiddenException(
          'Only a super admin can remove depense categories',
        );
      }
    }
    return this.settingService.updateSettings(data);
  }
}
