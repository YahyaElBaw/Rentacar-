import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Journee, JourneeDocument } from './schemas/journee.schema';

@Injectable()
export class JourneeService {
  private readonly logger = new Logger(JourneeService.name);

  constructor(
    @InjectModel(Journee.name) private journeeModel: Model<JourneeDocument>,
  ) {}

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  async getOrCreateCurrent(): Promise<JourneeDocument> {
    const today = this.getTodayString();
    try {
      const journee = await this.journeeModel
        .findOneAndUpdate(
          { date: today },
          {
            $setOnInsert: {
              date: today,
              status: 'open',
              entries: [],
              totalDaily: 0,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
      return journee;
    } catch (err) {
      this.logger.error(`Error getting or creating Journee for ${today}:`, err);
      const existing = await this.journeeModel.findOne({ date: today }).exec();
      if (existing) return existing;
      throw err;
    }
  }

  async addEntry(
    type: string,
    description: string,
    amount: number = 0,
    reference: string = '',
  ): Promise<JourneeDocument | null> {
    try {
      const journee = await this.getOrCreateCurrent();
      if (!journee) return null;

      if (journee.status === 'closed') {
        this.logger.error(`Cannot add entry to closed Journee ${journee.date}`);
        return journee;
      }

      journee.entries.push({
        entryType: type,
        type,
        description,
        amount,
        reference,
        time: new Date(),
      });

      journee.totalDaily += amount;
      return await journee.save();
    } catch (err) {
      this.logger.error(`Failed to add Journee entry: ${description}`, err);
      return null;
    }
  }

  async findAll(): Promise<JourneeDocument[]> {
    return this.journeeModel.find().sort({ date: -1 }).exec();
  }

  async remove(id: string): Promise<JourneeDocument | null> {
    return this.journeeModel.findByIdAndDelete(id).exec();
  }
}
