import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Vidange {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true })
  car: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  mileageAtChange: number;

  @Prop({ required: true })
  oilType: string;

  @Prop({ required: true })
  nextChangeMileage: number;

  @Prop({ required: true })
  amount: number;

  @Prop()
  notes: string;
}

export type VidangeDocument = Vidange & Document;
export const VidangeSchema = SchemaFactory.createForClass(Vidange);

VidangeSchema.index({ car: 1 });
VidangeSchema.index({ date: 1 });
