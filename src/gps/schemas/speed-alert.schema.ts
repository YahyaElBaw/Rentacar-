import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class SpeedAlert {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true, index: true })
  carId: Types.ObjectId;

  @Prop({ default: '' })
  matricule: string;

  @Prop({ default: '' })
  brand: string;

  @Prop({ default: '' })
  model: string;

  @Prop({ required: true })
  speed: number;

  @Prop({ default: 0 })
  limit: number;

  @Prop({ default: 0 })
  lat: number;

  @Prop({ default: 0 })
  lng: number;

  @Prop({ default: '' })
  provider: string;

  @Prop({ required: true })
  alertAt: Date;
}

export type SpeedAlertDocument = SpeedAlert & Document;
export const SpeedAlertSchema = SchemaFactory.createForClass(SpeedAlert);
