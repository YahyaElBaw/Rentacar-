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
    let journee = await this.journeeModel.findOne({ date: today }).exec();

    if (!journee) {
      journee = new this.journeeModel({
        date: today,
        status: 'open',
        entries: [],
        totalDaily: 0,
      });
      await journee.save();
    } else if (journee.status === 'closed') {
      // If today is somehow closed but we need an entry (rare case), 
      // we might want to log somewhere else, but for now we won't reopen it.
      this.logger.warn(`Attempted to access closed Journee for ${today}`);
    }

    return journee;
  }

  async addEntry(
    type: string,
    description: string,
    amount: number = 0,
    reference: string = '',
  ): Promise<JourneeDocument> {
    const journee = await this.getOrCreateCurrent();
    
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
  }

  async findAll(): Promise<JourneeDocument[]> {
    return this.journeeModel.find().sort({ date: -1 }).exec();
  }

  async remove(id: string): Promise<JourneeDocument | null> {
    return this.journeeModel.findByIdAndDelete(id).exec();
  }
}
