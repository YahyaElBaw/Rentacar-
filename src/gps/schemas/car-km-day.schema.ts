import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class CarKmDay {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true })
  carId: Types.ObjectId;

  /** Local day key, format YYYY-MM-DD */
  @Prop({ required: true })
  day: string;

  /** Accumulated km for this day */
  @Prop({ default: 0 })
  km: number;

  @Prop({ type: Number, default: null })
  lastLat: number | null;

  @Prop({ type: Number, default: null })
  lastLng: number | null;

  @Prop({ type: Date, default: null })
  lastFixAt: Date | null;

  @Prop({ default: false })
  alertSent: boolean;

  /** Highest speed recorded today (km/h) */
  @Prop({ default: 0 })
  topSpeed: number;
}

export type CarKmDayDocument = CarKmDay & Document;
export const CarKmDaySchema = SchemaFactory.createForClass(CarKmDay);
CarKmDaySchema.index({ carId: 1, day: 1 }, { unique: true });
