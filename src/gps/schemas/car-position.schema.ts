import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class CarPosition {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true, unique: true })
  carId: Types.ObjectId;

  @Prop({ required: true })
  lat: number;

  @Prop({ required: true })
  lng: number;

  @Prop({ default: 0 })
  speed: number;

  @Prop({ default: '' })
  provider: string;

  @Prop({ default: '' })
  imei: string;

  @Prop({ required: true })
  positionAt: Date;
}

export type CarPositionDocument = CarPosition & Document;
export const CarPositionSchema = SchemaFactory.createForClass(CarPosition);
