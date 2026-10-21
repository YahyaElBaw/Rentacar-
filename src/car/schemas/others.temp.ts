import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Reservation extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true })
  car: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true })
  client: Types.ObjectId;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({
    required: true,
    enum: ['pending', 'confirmed', 'cancelled'],
    default: 'pending',
  })
  status: string;

  @Prop({ required: true })
  totalAmount: number;
}

export const ReservationSchema = SchemaFactory.createForClass(Reservation);
ReservationSchema.index({ car: 1 });
ReservationSchema.index({ client: 1 });
ReservationSchema.index({ status: 1 });
ReservationSchema.index({ startDate: 1 });

@Schema({ timestamps: true })
export class Visite extends Document {
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

export const VisiteSchema = SchemaFactory.createForClass(Visite);
VisiteSchema.index({ car: 1 });
VisiteSchema.index({ date: 1 });

@Schema({ timestamps: true })
export class Vidange extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true })
  car: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  mileageAtChange: number;

  @Prop({ required: true })
  oilType: string;

  @Prop({ required: true })
  cost: number;

  @Prop({ required: true })
  nextChangeMileage: number;
}

export const VidangeSchema = SchemaFactory.createForClass(Vidange);
VidangeSchema.index({ car: 1 });
VidangeSchema.index({ date: 1 });

@Schema({ timestamps: true })
export class Depense extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: true })
  car: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({
    required: true,
    enum: ['repair', 'insurance', 'tax', 'fuel', 'other'],
    default: 'other',
  })
  category: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  description: string;

  @Prop()
  receipt: string;
}

export const DepenseSchema = SchemaFactory.createForClass(Depense);
DepenseSchema.index({ car: 1 });
DepenseSchema.index({ category: 1 });
DepenseSchema.index({ date: 1 });
