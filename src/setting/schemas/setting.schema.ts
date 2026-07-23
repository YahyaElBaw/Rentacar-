import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Setting {
  @Prop({ default: false })
  tvaEnabled: boolean;

  @Prop({ default: 20 })
  tvaValue: number;

  @Prop({ default: false })
  contractTaxEnabled: boolean;

  @Prop({ default: 0 })
  contractTaxValue: number;

  @Prop({ default: 10000 })
  vidangeLimit: number;

  @Prop({ default: 12 })
  assuranceLimit: number;

  @Prop({ default: 6 })
  visiteLimit: number;

  @Prop({ type: [String], default: [] })
  agencies: string[];
}

export type SettingDocument = Setting & Document;
export const SettingSchema = SchemaFactory.createForClass(Setting);
