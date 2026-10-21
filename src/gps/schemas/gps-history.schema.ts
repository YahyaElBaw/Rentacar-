import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: false, versionKey: false })
export class GpsHistory {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true })
  carId: Types.ObjectId;

  @Prop({ required: true })
  lat: number;

  @Prop({ required: true })
  lng: number;

  @Prop({ default: 0 })
  speed: number;

  @Prop({ default: '' })
  provider: string;

  @Prop({ required: true, index: true })
  positionAt: Date;

  @Prop({ default: false })
  uploaded: boolean;
}

export type GpsHistoryDocument = GpsHistory & Document;
export const GpsHistorySchema = SchemaFactory.createForClass(GpsHistory);

GpsHistorySchema.index({ carId: 1, positionAt: 1 });
GpsHistorySchema.index({ carId: 1, uploaded: 1 }, { partialFilterExpression: { uploaded: false } });
