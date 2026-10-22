import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose, { Connection } from 'mongoose';
import { DatabaseConfigService } from './database-config.service';
import { DatabaseReplicationService } from './database-replication.service';
import { EventsGateway } from '../events/events.gateway';
import { DatabaseConfig } from './interfaces/database-config.interface';

@Injectable()
export class DatabaseHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseHealthService.name);
  private checkInterval: NodeJS.Timeout | null = null;
  private isChecking = false;

  constructor(
    @InjectConnection() private readonly primaryConnection: Connection,
    private readonly configService: DatabaseConfigService,
    private readonly replicationService: DatabaseReplicationService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  onModuleInit() {
    // Start health checks after startup
    setTimeout(() => {
      void this.checkAllDatabases();
      this.checkInterval = setInterval(() => {
        void this.checkAllDatabases();
      }, 60000); // Check every 60 seconds (prevents connection spamming on M0 clusters)
    }, 5000);
  }

  onModuleDestroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  public async checkAllDatabases(): Promise<DatabaseConfig[]> {
    if (this.isChecking) return this.configService.getDatabases();
    this.isChecking = true;

    try {
      const dbs = this.configService.getDatabases();
      const registry = this.configService.getRegistry();

      for (const db of dbs) {
        if (!db.enabled) continue;
        const result = await this.pingDatabase(db);
        this.configService.updateRuntimeStatus(db.id, {
          status: result.status,
          latencyMs: result.latencyMs,
          lastChecked: new Date().toISOString(),
        });
      }

      // Check if primary is down or degraded
      const primary = this.configService.getPrimaryDb();
      if (primary && registry.autoFailover) {
        const isUnhealthy = primary.status === 'down' || (primary.latencyMs && primary.latencyMs > registry.maxLatencyMs);
        if (isUnhealthy) {
          const healthyBackup = dbs.find(
            (d) => d.id !== primary.id && d.enabled && d.status === 'healthy' && (d.latencyMs || 0) < registry.maxLatencyMs,
          );
          if (healthyBackup) {
            this.logger.warn(`⚠️ PRIMARY DATABASE UNHEALTHY (${primary.status}, ${primary.latencyMs}ms). TRIGGERING AUTO-FAILOVER TO: ${healthyBackup.name}`);
            this.configService.setPrimary(healthyBackup.id);
            this.eventsGateway.broadcastDataChange('database:failover', {
              previousPrimary: primary.id,
              newPrimary: healthyBackup.id,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // Broadcast health update
      this.eventsGateway.broadcastDataChange('database:status-update', {
        databases: this.configService.getDatabases(),
        activePrimaryId: this.configService.getRegistry().activePrimaryId,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      this.logger.error(`Error during database health check: ${err?.message}`);
    } finally {
      this.isChecking = false;
    }

    return this.configService.getDatabases();
  }

  public async pingDatabase(db: DatabaseConfig): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latencyMs: number;
    error?: string;
  }> {
    const start = Date.now();

    // 1. If this is the primary database, reuse the existing connection (NO new socket created!)
    if (db.role === 'primary' && this.primaryConnection.readyState === 1 && this.primaryConnection.db) {
      try {
        await this.primaryConnection.db.admin().ping();
        const latencyMs = Date.now() - start;
        const maxLatency = this.configService.getRegistry().maxLatencyMs || 4000;
        const status = latencyMs > maxLatency ? 'degraded' : 'healthy';
        return { status, latencyMs };
      } catch (err: any) {
        return { status: 'down', latencyMs: 9999, error: err?.message };
      }
    }

    // 2. For external backup databases, use a single temporary socket
    let conn: mongoose.Connection | null = null;
    try {
      conn = await mongoose.createConnection(db.uri, {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000,
        maxPoolSize: 1, // Strictly 1 socket for health ping
        minPoolSize: 1,
      }).asPromise();

      const admin = conn.db?.admin();
      if (admin) {
        await admin.ping();
      }
      const latencyMs = Date.now() - start;
      await conn.close();

      const maxLatency = this.configService.getRegistry().maxLatencyMs || 4000;
      const status = latencyMs > maxLatency ? 'degraded' : 'healthy';
      return { status, latencyMs };
    } catch (err: any) {
      if (conn) {
        try {
          await conn.close();
        } catch {}
      }
      return { status: 'down', latencyMs: 9999, error: err?.message };
    }
  }
}
