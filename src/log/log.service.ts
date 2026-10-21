import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Log, LogDocument } from './log.schema';

export interface LogFilters {
  search?: string;
  name?: string;
  actorId?: string;
  role?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class LogService {
  constructor(@InjectModel(Log.name) private logModel: Model<LogDocument>) {}

  async add(entry: Partial<Log>): Promise<LogDocument> {
    return this.logModel.create(entry);
  }

  async findAll(filters: LogFilters = {}): Promise<LogDocument[]> {
    const query: any = {};

    if (filters.search) {
      const rx = new RegExp(this.escapeRegex(filters.search), 'i');
      query.$or = [
        { action: rx },
        { detail: rx },
        { actorName: rx },
        { role: rx },
      ];
    }

    if (filters.name) {
      query.actorName = new RegExp(this.escapeRegex(filters.name), 'i');
    }

    if (filters.actorId) {
      query.actorId = filters.actorId;
    }

    if (filters.role) {
      query.role = filters.role;
    }

    if (filters.from || filters.to) {
      query.createdAt = {};
      if (filters.from) query.createdAt.$gte = new Date(filters.from);
      if (filters.to) {
        const to = new Date(filters.to);
        to.setHours(23, 59, 59, 999);
        query.createdAt.$lte = to;
      }
    }

    return this.logModel.find(query).sort({ createdAt: -1 }).limit(1000).exec();
  }

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
