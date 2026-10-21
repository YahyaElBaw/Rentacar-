import { Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EventsGateway } from '../events/events.gateway';

@Controller('presence')
export class PresenceController {
  constructor(
    private readonly presenceService: PresenceService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('heartbeat')
  async heartbeat(@Req() req: any) {
    const user = req.user;
    await this.presenceService.heartbeat(user.id, user.name, user.role);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: any) {
    await this.presenceService.remove(req.user.id);
    this.eventsGateway.broadcastOnlineUsers();
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('online')
  async online() {
    return this.presenceService.getOnline();
  }
}
