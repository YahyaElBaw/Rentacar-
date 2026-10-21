import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('version')
  getVersion(): { version: string } {
    return { version: this.appService.getAppVersion() };
  }

  @Get('ping')
  ping(): { ok: boolean; ts: number } {
    // Lightweight keep-alive endpoint — used by Vercel cron to prevent cold starts
    return { ok: true, ts: Date.now() };
  }

  @Post('admin/backup-db')
  async triggerBackupPost(@Body('uri') customUri?: string) {
    return this.appService.backupDatabase(customUri);
  }

  @Get('admin/backup-db')
  async triggerBackupGet(@Query('uri') customUri?: string) {
    return this.appService.backupDatabase(customUri);
  }
}
