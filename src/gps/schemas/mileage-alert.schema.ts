import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class MileageAlert {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true, index: true })
  carId: Types.ObjectId;

  @Prop({ default: '' })
  matricule: string;

  @Prop({ default: '' })
  brand: string;

  @Prop({ default: '' })
  model: string;

  /** Km traveled on the alerting day */
  @Prop({ required: true })
  kmToday: number;

  /** Configured max km/day at alert time */
  @Prop({ required: true })
  limit: number;

  @Prop({ default: '' })
  provider: string;

  @Prop({ required: true })
  alertAt: Date;
}

export type MileageAlertDocument = MileageAlert & Document;
export const MileageAlertSchema = SchemaFactory.createForClass(MileageAlert);
