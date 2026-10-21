import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TraciPollerService } from './traci-poller.service';
import { WinnouPollerService } from './winnou-poller.service';

@Injectable()
export class GpsLiveTrackerService implements OnModuleDestroy {
  private readonly logger = new Logger(GpsLiveTrackerService.name);
  private readonly subscribers = new Map<string, number>(); // clientId -> lastSeenMs
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly traciPoller: TraciPollerService,
    private readonly winnouPoller: WinnouPollerService,
  ) {
    // Check every 4 seconds for expired subscribers (timed out after 12s)
    this.cleanupTimer = setInterval(() => {
      this.sweepExpired();
    }, 4000);
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.stopPollers();
  }

  subscribe(clientId?: string) {
    const id = clientId || 'default';
    const wasEmpty = this.subscribers.size === 0;
    this.subscribers.set(id, Date.now());
    this.logger.log(`GPS subscriber joined: ${id} (active viewers: ${this.subscribers.size})`);
    if (wasEmpty) {
      this.startPollers();
    }
  }

  unsubscribe(clientId?: string) {
    const id = clientId || 'default';
    this.subscribers.delete(id);
    this.logger.log(`GPS subscriber left: ${id} (remaining viewers: ${this.subscribers.size})`);
    if (this.subscribers.size === 0) {
      this.stopPollers();
    }
  }

  ping(clientId?: string) {
    const id = clientId || 'default';
    if (!this.subscribers.has(id)) {
      this.subscribe(id);
    } else {
      this.subscribers.set(id, Date.now());
    }
  }

  private sweepExpired() {
    const now = Date.now();
    let removed = false;
    for (const [clientId, lastSeen] of this.subscribers.entries()) {
      if (now - lastSeen > 12000) {
        this.subscribers.delete(clientId);
        this.logger.log(`GPS subscriber timed out: ${clientId}`);
        removed = true;
      }
    }
    if (removed && this.subscribers.size === 0) {
      this.stopPollers();
    }
  }

  private startPollers() {
    this.logger.log(`⚡ Activating 1s GPS pollers (Suivi Flotte opened)`);
    this.traciPoller.start();
    this.winnouPoller.start();
  }

  private stopPollers() {
    this.logger.log(`💤 Pausing GPS pollers (Suivi Flotte closed - database is idle & fast)`);
    this.traciPoller.stop();
    this.winnouPoller.stop();
  }

  getStatus() {
    return {
      active: this.subscribers.size > 0,
      viewersCount: this.subscribers.size,
      traciRunning: this.traciPoller.isRunning,
      winnouRunning: this.winnouPoller.isRunning,
    };
  }
}
