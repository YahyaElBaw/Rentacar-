import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose, { Connection } from 'mongoose';
import { DatabaseConfigService } from './database-config.service';
import { DatabaseConfig } from './interfaces/database-config.interface';

const EXCLUDED_COLLECTIONS = new Set([
  'carkmdays',
  'gpshistories',
  'journees',
  'mileagealerts',
  'system.indexes',
  'system.profile',
]);

@Injectable()
export class DatabaseReplicationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseReplicationService.name);
  private backupConnections = new Map<string, mongoose.Connection>();
  private changeStream: any = null;
  private isReplicating = false;
  private isShuttingDown = false;

  constructor(
    @InjectConnection() private readonly primaryConnection: Connection,
    private readonly configService: DatabaseConfigService,
  ) {}

  async onModuleInit() {
    // Connect to all enabled backup databases and start real-time change stream replication
    setTimeout(() => {
      void this.initializeReplication();
    }, 3000);
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    if (this.changeStream) {
      try {
        await this.changeStream.close();
      } catch {}
    }
    for (const [id, conn] of this.backupConnections.entries()) {
      try {
        await conn.close();
      } catch {}
    }
    this.backupConnections.clear();
  }

  public async initializeReplication() {
    if (this.isShuttingDown) return;
    const backupDbs = this.configService.getBackupDbs();
    this.logger.log(`Initializing multi-database replication for ${backupDbs.length} backup cluster(s)...`);

    for (const db of backupDbs) {
      await this.connectBackup(db);
    }

    if (this.configService.getRegistry().realtimeSync) {
      this.startChangeStream();
    }
  }

  private async connectBackup(db: DatabaseConfig): Promise<mongoose.Connection | null> {
    if (this.backupConnections.has(db.id)) {
      const existing = this.backupConnections.get(db.id)!;
      if (existing.readyState === 1) return existing;
    }

    try {
      this.logger.log(`Connecting to backup database: ${db.name}...`);
      const conn = await mongoose.createConnection(db.uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      }).asPromise();

      this.backupConnections.set(db.id, conn);
      this.configService.updateRuntimeStatus(db.id, {
        status: 'healthy',
        lastChecked: new Date().toISOString(),
      });
      this.logger.log(`✓ Connected to backup database: ${db.name}`);
      return conn;
    } catch (err: any) {
      this.logger.warn(`Failed to connect to backup ${db.name}: ${err?.message}`);
      this.configService.updateRuntimeStatus(db.id, {
        status: 'down',
        lastChecked: new Date().toISOString(),
      });
      return null;
    }
  }

  /**
   * MongoDB Atlas Change Stream: watches all collections on the primary database
   * and mirrors all operations (insert, update, replace, delete) to all backup databases in real-time.
   */
  private startChangeStream() {
    if (this.changeStream || this.isShuttingDown) return;

    try {
      const primaryDb = this.primaryConnection.db;
      if (!primaryDb) return;

      this.logger.log('Starting real-time MongoDB change stream replicator...');
      this.changeStream = this.primaryConnection.watch([], {
        fullDocument: 'updateLookup',
      });

      this.changeStream.on('change', async (change: any) => {
        await this.handleDbChange(change);
      });

      this.changeStream.on('error', (err: any) => {
        this.logger.warn(`Change stream error: ${err?.message}`);
        this.changeStream = null;
        if (!this.isShuttingDown) {
          setTimeout(() => this.startChangeStream(), 5000);
        }
      });
    } catch (err: any) {
      this.logger.warn(`Could not start change stream: ${err?.message}`);
    }
  }

  private async handleDbChange(change: any) {
    if (!change?.ns?.coll) return;
    const collName = change.ns.coll;
    if (EXCLUDED_COLLECTIONS.has(collName.toLowerCase())) return;

    const backupDbs = this.configService.getBackupDbs();
    for (const dbConfig of backupDbs) {
      let conn = this.backupConnections.get(dbConfig.id);
      if (!conn || conn.readyState !== 1) {
        conn = (await this.connectBackup(dbConfig)) || undefined;
      }
      if (!conn?.db) continue;

      try {
        const destColl = conn.db.collection(collName);
        const docId = change.documentKey?._id;

        switch (change.operationType) {
          case 'insert':
            if (change.fullDocument) {
              await destColl.replaceOne({ _id: docId }, change.fullDocument, { upsert: true });
            }
            break;
          case 'update':
            if (change.updateDescription) {
              const updateDoc: any = {};
              if (change.updateDescription.updatedFields && Object.keys(change.updateDescription.updatedFields).length > 0) {
                updateDoc.$set = change.updateDescription.updatedFields;
              }
              if (change.updateDescription.removedFields && change.updateDescription.removedFields.length > 0) {
                const unsetMap: Record<string, string> = {};
                for (const f of change.updateDescription.removedFields) unsetMap[f] = '';
                updateDoc.$unset = unsetMap;
              }
              if (Object.keys(updateDoc).length > 0) {
                await destColl.updateOne({ _id: docId }, updateDoc);
              }
            } else if (change.fullDocument) {
              await destColl.replaceOne({ _id: docId }, change.fullDocument, { upsert: true });
            }
            break;
          case 'replace':
            if (change.fullDocument) {
              await destColl.replaceOne({ _id: docId }, change.fullDocument, { upsert: true });
            }
            break;
          case 'delete':
            await destColl.deleteOne({ _id: docId });
            break;
          case 'drop':
            try {
              await destColl.drop();
            } catch {}
            break;
        }

        this.configService.updateRuntimeStatus(dbConfig.id, {
          syncStatus: 'in_sync',
          lastSyncedAt: new Date().toISOString(),
        });
      } catch (err: any) {
        this.logger.warn(`Failed to replicate change to ${dbConfig.name}: ${err?.message}`);
        this.configService.updateRuntimeStatus(dbConfig.id, {
          syncStatus: 'failed',
        });
      }
    }
  }

  /**
   * Full Clone / Sync of the primary database to a specific target backup database.
   */
  public async syncAllToTarget(targetDbId: string): Promise<{
    success: boolean;
    collections: Array<{ name: string; count: number }>;
    totalDocuments: number;
    durationMs: number;
  }> {
    const startTime = Date.now();
    const targetDbConfig = this.configService.getDatabases().find((d) => d.id === targetDbId);
    if (!targetDbConfig) {
      throw new Error(`Base de données de secours '${targetDbId}' introuvable.`);
    }

    const sourceDb = this.primaryConnection.db;
    if (!sourceDb) throw new Error('Base de données principale indisponible.');

    this.configService.updateRuntimeStatus(targetDbId, { syncStatus: 'syncing' });
    this.logger.log(`Starting full database sync to: ${targetDbConfig.name}...`);

    let targetConn = this.backupConnections.get(targetDbId);
    if (!targetConn || targetConn.readyState !== 1) {
      targetConn = (await this.connectBackup(targetDbConfig)) || undefined;
    }
    if (!targetConn?.db) {
      this.configService.updateRuntimeStatus(targetDbId, { syncStatus: 'failed' });
      throw new Error(`Impossible de se connecter à la base de secours '${targetDbConfig.name}'.`);
    }

    const targetDb = targetConn.db;
    const rawCollections = await sourceDb.listCollections().toArray();
    const collections = rawCollections.filter(
      (c) => !EXCLUDED_COLLECTIONS.has(c.name.toLowerCase()),
    );

    let totalDocsCopied = 0;
    const summary: Array<{ name: string; count: number }> = [];

    for (const collInfo of collections) {
      const collName = collInfo.name;
      const srcColl = sourceDb.collection(collName);
      const destColl = targetDb.collection(collName);

      const count = await srcColl.countDocuments();
      if (count === 0) {
        summary.push({ name: collName, count: 0 });
        continue;
      }

      await destColl.deleteMany({});
      const cursor = srcColl.find({});
      const batchSize = 500;
      let batch: any[] = [];
      let collCopied = 0;

      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        if (doc) {
          batch.push(doc);
          if (batch.length >= batchSize) {
            await destColl.insertMany(batch, { ordered: false });
            collCopied += batch.length;
            batch = [];
          }
        }
      }

      if (batch.length > 0) {
        await destColl.insertMany(batch, { ordered: false });
        collCopied += batch.length;
      }

      // Copy indexes
      try {
        const indexes = await srcColl.indexes();
        const customIndexes = indexes.filter((idx) => idx.name !== '_id_');
        for (const idx of customIndexes) {
          const { key, name, unique, sparse, expireAfterSeconds } = idx as any;
          const opts: any = {};
          if (name) opts.name = name;
          if (unique) opts.unique = unique;
          if (sparse) opts.sparse = sparse;
          if (expireAfterSeconds !== undefined) opts.expireAfterSeconds = expireAfterSeconds;
          await destColl.createIndex(key, opts);
        }
      } catch (err: any) {
        this.logger.warn(`Warning copying indexes for ${collName}: ${err?.message}`);
      }

      summary.push({ name: collName, count: collCopied });
      totalDocsCopied += collCopied;
    }

    const durationMs = Date.now() - startTime;
    this.configService.updateRuntimeStatus(targetDbId, {
      syncStatus: 'in_sync',
      lastSyncedAt: new Date().toISOString(),
    });
    this.logger.log(`✓ Full database sync completed for ${targetDbConfig.name}: ${totalDocsCopied} docs in ${(durationMs / 1000).toFixed(1)}s`);

    return {
      success: true,
      collections: summary,
      totalDocuments: totalDocsCopied,
      durationMs,
    };
  }
}
