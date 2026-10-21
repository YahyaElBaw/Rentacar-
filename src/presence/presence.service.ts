import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Presence, PresenceDocument } from './presence.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

export const ONLINE_THRESHOLD_MS = 90_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private lastTouch = new Map<string, number>();

  constructor(
    @InjectModel(Presence.name) private presenceModel: Model<PresenceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async heartbeat(
    userId: string,
    name: string,
    role: string,
    device = 'pc',
  ): Promise<void> {
    await this.presenceModel.updateOne(
      { userId, device },
      { $set: { userId, device, name, role, lastSeen: new Date() } },
      { upsert: true },
    );
  }

  async touch(
    userId: string,
    device?: string,
    name?: string,
    role?: string,
  ): Promise<void> {
    const dev = device || 'pc';
    const now = Date.now();
    const throttleKey = `${userId}:${dev}`;
    const last = this.lastTouch.get(throttleKey) || 0;
    if (now - last < 20_000) return;
    this.lastTouch.set(throttleKey, now);
    if (this.lastTouch.size > 500) this.lastTouch.clear();

    // Single upsert — merge lastSeen, name and role in one round-trip
    const patch: Record<string, any> = { userId, device: dev, lastSeen: new Date() };
    if (name) patch.name = name;
    if (role) patch.role = role;
    await this.presenceModel.updateOne(
      { userId, device: dev },
      { $set: patch },
      { upsert: true },
    );
  }

  onModuleInit() {
    // Drop legacy unique index on userId alone (pre-multi-device schema)
    this.presenceModel.collection
      .indexes()
      .then((indexes: any[]) => {
        const legacy = indexes.find(
          (i) =>
            i.unique &&
            Object.keys(i.key).length === 1 &&
            'userId' in i.key &&
            !('device' in i.key),
        );
        if (legacy) {
          return this.presenceModel.collection.dropIndex(legacy.name);
        }
        return undefined;
      })
      .catch(() => {
        /* ignore */
      });
    this.purgeOrphans().catch(() => {
      /* ignore */
    });
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(() => {
        /* ignore */
      });
      this.purgeOrphans().catch(() => {
        /* ignore */
      });
    }, CLEANUP_INTERVAL_MS);
  }

  // Remove presence rows whose user no longer exists (deleted accounts)
  async purgeOrphans(): Promise<void> {
    const userIds = await this.userModel.distinct('_id').lean().exec();
    const valid = new Set(userIds.map((id: any) => String(id)));
    const rows = await this.presenceModel
      .find({}, { userId: 1 })
      .lean()
      .exec();
    const orphanIds = rows
      .filter((r: any) => !valid.has(String(r.userId)))
      .map((r: any) => r._id);
    if (orphanIds.length) {
      await this.presenceModel.deleteMany({ _id: { $in: orphanIds } });
    }
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async getOnline(): Promise<{ count: number; users: any[] }> {
    const since = new Date(Date.now() - ONLINE_THRESHOLD_MS);
    const docs = await this.presenceModel
      .find({ lastSeen: { $gte: since } })
      .sort({ lastSeen: -1 })
      .lean()
      .exec();
    const byUser = new Map<string, any>();
    for (const d of docs) {
      const dev = d.device || 'pc';
      const existing = byUser.get(d.userId);
      if (existing) {
        if (!existing.devices.includes(dev)) existing.devices.push(dev);
      } else {
        byUser.set(d.userId, {
          userId: d.userId,
          name: d.name,
          role: d.role,
          device: dev,
          devices: [dev],
          lastSeen: d.lastSeen,
        });
      }
    }
    const users = Array.from(byUser.values());
    return { count: users.length, users };
  }

  async remove(userId: string, device?: string): Promise<void> {
    if (device) {
      await this.presenceModel.deleteOne({ userId, device });
    } else {
      await this.presenceModel.deleteMany({ userId });
    }
  }

  async cleanup(): Promise<void> {
    const since = new Date(Date.now() - ONLINE_THRESHOLD_MS);
    await this.presenceModel.deleteMany({ lastSeen: { $lt: since } });
  }
}
