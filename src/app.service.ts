import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import dns from 'dns';
import mongoose, { Connection } from 'mongoose';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit() {
    try {
      const db = this.connection.db;
      if (!db) return;
      const collections = await db.listCollections().toArray();
      const existingNames = collections.map((c) => c.name.toLowerCase());
      const toDrop = ['carkmdays', 'gpshistories', 'journees', 'mileagealerts'];

      for (const name of toDrop) {
        const found = collections.find((c) => c.name.toLowerCase() === name);
        if (found) {
          try {
            await db.collection(found.name).drop();
            this.logger.log(`Dropped obsolete collection from MongoDB: ${found.name}`);
          } catch (err: any) {
            this.logger.warn(`Could not drop collection ${found.name}: ${err?.message}`);
          }
        }
      }
    } catch (err) {
      this.logger.error('Error during obsolete collections cleanup:', err);
    }
  }

  getHello(): string {
    return 'Hello World!';
  }

  getAppVersion(): string {
    return '1.1.0'; // Current Production Version
  }

  async backupDatabase(targetUriOverride?: string): Promise<{
    success: boolean;
    collections: Array<{ name: string; count: number }>;
    totalDocuments: number;
    durationMs: number;
  }> {
    const startTime = Date.now();
    const targetUri =
      targetUriOverride ||
      process.env.BACKUP_MONGODB_URI ||
      'mongodb://yahyabaw8_db_user:OWD4NtSW5cYlIYa7@ac-0blwqgq-shard-00-00.61ztixt.mongodb.net:27017,ac-0blwqgq-shard-00-01.61ztixt.mongodb.net:27017,ac-0blwqgq-shard-00-02.61ztixt.mongodb.net:27017/rentacar?tls=true&replicaSet=atlas-wso6kp-shard-0&authSource=admin&retryWrites=true&w=majority';

    const sourceDb = this.connection.db;
    if (!sourceDb) throw new Error('Base de données source indisponible');

    this.logger.log('Starting MongoDB clone to backup cluster...');
    const targetConn = await mongoose.createConnection(targetUri).asPromise();
    const targetDb = targetConn.db;
    if (!targetDb) {
      await targetConn.close();
      throw new Error('Base de données de destination indisponible');
    }

    const EXCLUDED = new Set([
      'carkmdays',
      'gpshistories',
      'journees',
      'mileagealerts',
      'system.indexes',
      'system.profile',
    ]);

    const rawCollections = await sourceDb.listCollections().toArray();
    const collections = rawCollections.filter(
      (c) => !EXCLUDED.has(c.name.toLowerCase()),
    );

    let totalDocs = 0;
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

      try {
        const indexes = await srcColl.indexes();
        const customIndexes = indexes.filter((idx) => idx.name !== '_id_');
        for (const idx of customIndexes) {
          const { key, name, unique, sparse, expireAfterSeconds } = idx as any;
          const opts: any = {};
          if (name) opts.name = name;
          if (unique) opts.unique = unique;
          if (sparse) opts.sparse = sparse;
          if (expireAfterSeconds !== undefined)
            opts.expireAfterSeconds = expireAfterSeconds;
          await destColl.createIndex(key, opts);
        }
      } catch (err: any) {
        this.logger.warn(`Warning copying indexes for ${collName}: ${err?.message}`);
      }

      summary.push({ name: collName, count: collCopied });
      totalDocs += collCopied;
    }

    await targetConn.close();
    const durationMs = Date.now() - startTime;
    this.logger.log(
      `✓ Backup complete: ${summary.length} collections, ${totalDocs} documents copied in ${(durationMs / 1000).toFixed(1)}s`,
    );

    return {
      success: true,
      collections: summary,
      totalDocuments: totalDocs,
      durationMs,
    };
  }
}
