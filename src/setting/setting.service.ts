import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Setting, SettingDocument } from './schemas/setting.schema';

@Injectable()
export class SettingService implements OnModuleInit {
  constructor(@InjectModel(Setting.name) private settingModel: Model<SettingDocument>) {}

  async onModuleInit() {
    const count = await this.settingModel.countDocuments();
    if (count === 0) {
      await this.settingModel.create({
        tvaEnabled: false,
        tvaValue: 20,
        contractTaxEnabled: false,
        contractTaxValue: 0,
      });
    }
  }

  async getSettings(): Promise<SettingDocument> {
    const settings = await this.settingModel.findOne().exec();
    if (!settings) {
      return this.settingModel.create({});
    }
    return settings;
  }

  async updateSettings(data: Partial<Setting>): Promise<SettingDocument> {
    const settings = await this.settingModel.findOneAndUpdate({}, data, { new: true }).exec();
    if (!settings) {
      return this.settingModel.create(data);
    }
    return settings;
  }
}
