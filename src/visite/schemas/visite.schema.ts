import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Visite {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true })
  car: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  mileageAtVisit: number;

  @Prop({ required: true, enum: ['pass', 'fail'] })
  result: string;

  @Prop()
  notes: string;

  @Prop({ required: true })
  cost: number;

  @Prop({ required: true })
  nextVisitDate: Date;
}

export type VisiteDocument = Visite & Document;
export const VisiteSchema = SchemaFactory.createForClass(Visite);
VisiteSchema.index({ car: 1 });
VisiteSchema.index({ date: 1 });

@Schema({ timestamps: true })
export class Vidange {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true })
  car: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  mileageAtVidange: number;

  @Prop({ required: true })
  oilType: string;

  @Prop({ required: true })
  cost: number;

  @Prop({ required: true })
  nextVidangeDate: Date;
}

export type VidangeDocument = Vidange & Document;
export const VidangeSchema = SchemaFactory.createForClass(Vidange);
VidangeSchema.index({ car: 1 });
VidangeSchema.index({ date: 1 });
