import { config } from 'dotenv';
import { resolve } from 'path';
import mongoose from 'mongoose';

config({ path: resolve(process.cwd(), '.env') });

const isCin = (value: string) => /^\d+$/.test(String(value).trim());

async function fixLogs() {
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

  const logs = db.collection('logs');
  const users = db.collection('users');

  const allUsers = await users.find({}).toArray();
  const byId = new Map(allUsers.map((u) => [u._id.toString(), u]));
  const byCin = new Map(allUsers.map((u) => [String(u.cin), u]));
  const byName = new Map(
    allUsers.map((u) => [
      `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase(),
      u,
    ]),
  );

  const allLogs = await logs.find({}).toArray();
  let updated = 0;
  let skipped = 0;

  for (const log of allLogs) {
    let user: any = null;

    if (log.actorId) {
      user = byId.get(log.actorId.toString()) || null;
    }

    if (!user && log.actorName && isCin(log.actorName)) {
      user = byCin.get(log.actorName.trim()) || null;
    }

    if (!user && log.actorName && !isCin(log.actorName)) {
      user =
        byName.get(String(log.actorName).trim().toLowerCase()) || null;
    }

    if (!user) {
      skipped++;
      continue;
    }

    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    const role = user.role;

    const updateData: Record<string, any> = {};
    if (name && log.actorName !== name) updateData.actorName = name;
    if (role && log.role !== role) updateData.role = role;
    if (!log.actorId && user._id) updateData.actorId = user._id.toString();

    if (Object.keys(updateData).length === 0) {
      skipped++;
      continue;
    }

    await logs.updateOne({ _id: log._id }, { $set: updateData });
    updated++;
    console.log(
      `Updated log ${log._id} (${log.action}):`,
      JSON.stringify(updateData),
    );
  }

  console.log(
    `\nDone. Updated ${updated} log(s), skipped ${skipped} (no resolvable actor).`,
  );
  await mongoose.disconnect();
}

fixLogs().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
