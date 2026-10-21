import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DatabaseConfigService } from './database-config.service';
import { DatabaseReplicationService } from './database-replication.service';
import { DatabaseHealthService } from './database-health.service';
import { resolveAndNormalizeMongoUri } from './database-resolver.util';

@UseGuards(JwtAuthGuard)
@Controller('database')
export class DatabaseController {
  constructor(
    private readonly configService: DatabaseConfigService,
    private readonly replicationService: DatabaseReplicationService,
    private readonly healthService: DatabaseHealthService,
  ) {}

  private checkSuperAdmin(req: any) {
    const user = req.user;
    if (!user || user.role !== 'super_admin') {
      throw new ForbiddenException(
        'Accès réservé exclusivement au Super Administrateur.',
      );
    }
  }

  private maskCredentials(uri?: string): string {
    if (!uri) return '';
    return uri.replace(/:([^:@]+)@/, ':••••••@');
  }

  @Get('status')
  async getStatus(@Req() req: any) {
    this.checkSuperAdmin(req);
    const dbs = await this.healthService.checkAllDatabases();
    const registry = this.configService.getRegistry();

    const sanitizedDbs = dbs.map((db) => ({
      ...db,
      uri: this.maskCredentials(db.uri),
      originalUri: db.originalUri ? this.maskCredentials(db.originalUri) : undefined,
    }));

    return {
      registry: {
        ...registry,
        databases: sanitizedDbs,
      },
      databases: sanitizedDbs,
      activePrimaryId: registry.activePrimaryId,
      autoFailover: registry.autoFailover,
      realtimeSync: registry.realtimeSync,
      maxLatencyMs: registry.maxLatencyMs,
    };
  }

  @Post('resolve')
  async resolveUri(@Req() req: any, @Body('uri') uri: string) {
    this.checkSuperAdmin(req);
    try {
      const res = await resolveAndNormalizeMongoUri(uri);
      return {
        ...res,
        normalizedUri: this.maskCredentials(res.normalizedUri),
      };
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'Lien MongoDB invalide ou inaccessible.');
    }
  }

  @Post('add')
  async addDatabase(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      uri: string;
      autoClone?: boolean;
    },
  ) {
    this.checkSuperAdmin(req);
    if (!body.name || !body.uri) {
      throw new BadRequestException('Nom et lien MongoDB requis.');
    }

    try {
      // 1. Auto-resolve & normalize the URI (even from mongodb+srv://)
      const resolved = await resolveAndNormalizeMongoUri(body.uri);

      const id = `cluster-${Date.now().toString(36)}`;
      const newDb = {
        id,
        name: body.name.trim(),
        uri: resolved.normalizedUri,
        originalUri: body.uri.trim(),
        role: 'backup' as const,
        enabled: true,
        status: 'healthy' as const,
        latencyMs: resolved.latencyMs,
        dbName: resolved.dbName,
        hosts: resolved.hosts,
        replicaSet: resolved.replicaSet,
        syncStatus: 'not_synced' as const,
      };

      this.configService.addDatabase(newDb);

      // 2. Auto-clone initial data if requested
      let cloneResult = null;
      if (body.autoClone !== false) {
        try {
          cloneResult = await this.replicationService.syncAllToTarget(id);
        } catch (err: any) {
          // Will be reflected in status
        }
      }

      return {
        success: true,
        database: newDb,
        cloneResult,
      };
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'Erreur lors de l\'ajout de la base de données.');
    }
  }

  @Post('sync/:id')
  async syncDatabase(@Req() req: any, @Param('id') id: string) {
    this.checkSuperAdmin(req);
    return this.replicationService.syncAllToTarget(id);
  }

  @Post('failover/:id')
  async failoverDatabase(@Req() req: any, @Param('id') id: string) {
    this.checkSuperAdmin(req);
    this.configService.setPrimary(id);
    return {
      success: true,
      activePrimaryId: id,
      message: `La base ${id} a été promue en base principale avec succès.`,
    };
  }

  @Delete(':id')
  async deleteDatabase(@Req() req: any, @Param('id') id: string) {
    this.checkSuperAdmin(req);
    const removed = this.configService.removeDatabase(id);
    return { success: removed };
  }

  @Patch('settings')
  async updateSettings(
    @Req() req: any,
    @Body()
    body: {
      autoFailover?: boolean;
      realtimeSync?: boolean;
      maxLatencyMs?: number;
    },
  ) {
    this.checkSuperAdmin(req);
    this.configService.updateSettings(body);
    return {
      success: true,
      registry: this.configService.getRegistry(),
    };
  }
}
