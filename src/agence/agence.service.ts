import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agence, AgenceDocument } from './schemas/agence.schema';

@Injectable()
export class AgenceService {
  constructor(
    @InjectModel(Agence.name) private agenceModel: Model<AgenceDocument>,
  ) {}

  async findAll(): Promise<AgenceDocument[]> {
    return this.agenceModel.find().sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string): Promise<AgenceDocument> {
    const agence = await this.agenceModel.findById(id).exec();
    if (!agence) {
      throw new NotFoundException(`Agence with ID ${id} not found`);
    }
    return agence;
  }

  async findByName(name: string): Promise<AgenceDocument | null> {
    return this.agenceModel.findOne({ name }).exec();
  }

  async create(data: Partial<Agence>): Promise<AgenceDocument> {
    const created = new this.agenceModel(data);
    return created.save();
  }

  async update(id: string, data: Partial<Agence>): Promise<AgenceDocument> {
    const updated = await this.agenceModel
      .findByIdAndUpdate(id, data, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException(`Agence with ID ${id} not found`);
    }
    return updated;
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const result = await this.agenceModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Agence with ID ${id} not found`);
    }
    return { deleted: true };
  }
}
