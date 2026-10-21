import { config } from 'dotenv';
import { resolve } from 'path';
import dns from 'dns';
import mongoose from 'mongoose';

// Fix Node.js Windows SRV DNS resolution failure (querySrv ECONNREFUSED)
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  // ignore
}

config({ path: resolve(process.cwd(), '.env') });

const SOURCE_URI = process.env.MONGODB_URI || '';
const TARGET_URI = process.env.BACKUP_MONGODB_URI || '';

if (!SOURCE_URI || !TARGET_URI) {
  throw new Error('MONGODB_URI et BACKUP_MONGODB_URI doivent être configurés dans le fichier .env');
}

const EXCLUDED_COLLECTIONS = new Set([
  'carkmdays',
  'gpshistories',
  'journees',
  'mileagealerts',
  'system.indexes',
  'system.profile',
]);

async function copyDatabase() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('🔄 STARTING MONGODB DATABASE BACKUP & CLONE');
  console.log('====================================================');
  console.log('Source URI:', SOURCE_URI.replace(/:[^:@]+@/, ':***@'));
  console.log('Target Backup URI:', TARGET_URI.replace(/:[^:@]+@/, ':***@'));

  console.log('\n[1/4] Connecting to source database...');
  const sourceConn = await mongoose.createConnection(SOURCE_URI).asPromise();
  const sourceDb = sourceConn.db;
  if (!sourceDb) throw new Error('Failed to get source database instance');
  console.log('✓ Connected to source database:', sourceDb.databaseName);

  console.log('\n[2/4] Connecting to target backup database...');
  const targetConn = await mongoose.createConnection(TARGET_URI).asPromise();
  const targetDb = targetConn.db;
  if (!targetDb) throw new Error('Failed to get target database instance');
  console.log('✓ Connected to target backup database:', targetDb.databaseName);

  console.log('\n[3/4] Discovering collections...');
  const rawCollections = await sourceDb.listCollections().toArray();
  const collections = rawCollections.filter(
    (c) => !EXCLUDED_COLLECTIONS.has(c.name.toLowerCase()),
  );

  console.log(
    `Found ${collections.length} collections to clone:`,
    collections.map((c) => c.name).join(', '),
  );

  console.log('\n[4/4] Copying data and indexes...');
  let totalDocsCopied = 0;
  const summary: Array<{ name: string; count: number }> = [];

  for (const collInfo of collections) {
    const collName = collInfo.name;
    const srcColl = sourceDb.collection(collName);
    const destColl = targetDb.collection(collName);

    const docCount = await srcColl.countDocuments();
    if (docCount === 0) {
      console.log(`  - ${collName}: 0 documents (empty, created collection)`);
      summary.push({ name: collName, count: 0 });
      continue;
    }

    console.log(`  ▶ Copying ${collName} (${docCount} docs)...`);

    // Clean destination collection before fresh backup
    await destColl.deleteMany({});

    // Read in batches of 500 to keep memory low and prevent network timeouts
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

    // Copy indexes (except _id_ which is default)
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
      console.warn(`    ⚠️ Warning copying indexes for ${collName}:`, err?.message);
    }

    console.log(`    ✓ ${collName}: ${collCopied} documents copied successfully.`);
    totalDocsCopied += collCopied;
    summary.push({ name: collName, count: collCopied });
  }

  console.log('\n[Cleaning Up] Closing database connections...');
  await sourceConn.close();
  await targetConn.close();

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n====================================================');
  console.log('✅ BACKUP COMPLETE!');
  console.log(`Total Collections: ${summary.length}`);
  console.log(`Total Documents:   ${totalDocsCopied}`);
  console.log(`Duration:          ${durationSec}s`);
  console.log('====================================================');
}

copyDatabase().catch((err) => {
  console.error('\n❌ Backup failed with error:', err);
  process.exit(1);
});
