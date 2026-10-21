import { config } from 'dotenv';
import { resolve } from 'path';
import mongoose from 'mongoose';

config({ path: resolve(process.cwd(), '.env') });

async function clearGpsHistory() {
  const mongoUri =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/rentacar';

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error('Failed to connect to MongoDB');
    await mongoose.disconnect();
    return;
  }

  const collections = await db.listCollections().toArray();
  const existingNames = collections.map((c) => c.name);
  console.log('Existing collections:', existingNames.join(', '));

  const toDrop = ['carkmdays', 'gpshistories', 'journees', 'mileagealerts'];

  for (const name of toDrop) {
    const found = collections.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (found) {
      try {
        await db.collection(found.name).drop();
        console.log(`✓ Dropped collection: ${found.name}`);
      } catch (err: any) {
        console.log(`Could not drop ${found.name}: ${err?.message}`);
      }
    } else {
      console.log(`- Collection "${name}" not found (already clean).`);
    }
  }

  await mongoose.disconnect();
}

clearGpsHistory().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});