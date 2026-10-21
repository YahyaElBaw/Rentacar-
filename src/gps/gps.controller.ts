import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GpsService } from './gps.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { TraciPollerService } from './traci-poller.service';
import { WinnouPollerService } from './winnou-poller.service';
import { GpsLiveTrackerService } from './gps-live-tracker.service';

@Controller('gps')
export class GpsController {
  private lastPollAt = 0;
  private pollPromise: Promise<any> | null = null;

  constructor(
    private readonly gpsService: GpsService,
    private readonly configService: ConfigService,
    private readonly traciPoller: TraciPollerService,
    private readonly winnouPoller: WinnouPollerService,
    private readonly gpsTracker: GpsLiveTrackerService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('tracking/start')
  startTracking(@Body('clientId') clientId?: string) {
    this.gpsTracker.subscribe(clientId);
    return { ok: true, status: this.gpsTracker.getStatus() };
  }

  @UseGuards(JwtAuthGuard)
  @Post('tracking/stop')
  stopTracking(@Body('clientId') clientId?: string) {
    this.gpsTracker.unsubscribe(clientId);
    return { ok: true, status: this.gpsTracker.getStatus() };
  }

  @UseGuards(JwtAuthGuard)
  @Post('tracking/ping')
  pingTracking(@Body('clientId') clientId?: string) {
    this.gpsTracker.ping(clientId);
    return { ok: true, status: this.gpsTracker.getStatus() };
  }

  @UseGuards(JwtAuthGuard)
  @Get('tracking/status')
  getTrackingStatus() {
    return this.gpsTracker.getStatus();
  }

  /**
   * Fire an on-demand poll in the background (non-blocking).
   * The pollers already run every 1s on their own timers; this just
   * kicks them if the REST caller needs fresher data.
   */
  private triggerPollIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastPollAt < 1500) return;
    if (this.pollPromise) return;
    this.lastPollAt = now;
    this.pollPromise = Promise.allSettled([
      this.traciPoller.poll(),
      this.winnouPoller.poll(),
    ]).finally(() => {
      this.pollPromise = null;
    });
  }

  // Ingestion endpoint for external GPS platforms (traci.tn, winnou.tn, ...)
  @Post('webhook')
  async webhook(@Req() req: any, @Body() body: any) {
    const expectedKey = this.configService.get<string>('GPS_API_KEY');
    if (!expectedKey || req.headers['x-gps-key'] !== expectedKey) {
      throw new ForbiddenException('Clé GPS invalide.');
    }

    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { accepted: false, reason: 'lat/lng manquants' };
    }

    return this.gpsService.ingest({
      imei: body?.imei ? String(body.imei) : undefined,
      plate: body?.plate || body?.matricule || undefined,
      provider: body?.provider || undefined,
      lat,
      lng,
      speed: Number(body?.speed) || 0,
      at: body?.at,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('positions')
  async getPositions() {
    this.triggerPollIfNeeded();
    return this.gpsService.getPositions();
  }

  @UseGuards(JwtAuthGuard)
  @Get('speed-alerts')
  getSpeedAlerts(@Query('limit') limit?: string) {
    return this.gpsService.getSpeedAlerts(Number(limit) || 50);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('speed-alerts/:id')
  deleteSpeedAlert(@Param('id') id: string) {
    return this.gpsService.deleteSpeedAlert(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('test-speed-alert')
  async testSpeedAlert(@Body() body: { carId: string }) {
    return this.gpsService.testSpeedAlert(body.carId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('km-today')
  getKmToday() {
    return this.gpsService.getKmToday();
  }

  // Sync endpoint for external cron jobs or Vercel Crons
  @Get('sync')
  async syncGps() {
    await Promise.allSettled([
      this.traciPoller.poll(),
      this.winnouPoller.poll(),
    ]);
    return {
      ok: true,
      timestamp: new Date().toISOString(),
      traci: this.traciPoller.status,
      winnou: this.winnouPoller.status,
    };
  }
}
