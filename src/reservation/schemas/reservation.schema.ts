import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Reservation {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: false })
  car: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Client' }], required: true })
  clients: Types.ObjectId[];

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ default: 'pending', enum: ['pending', 'confirmed', 'cancelled'] })
  status: string;

  @Prop()
  notes: string;

  @Prop({ default: 0 })
  totalAmount: number;

  @Prop({ type: Types.ObjectId, ref: 'Contrat' })
  contrat: Types.ObjectId;
}

export type ReservationDocument = Reservation & Document;
export const ReservationSchema = SchemaFactory.createForClass(Reservation);

ReservationSchema.index({ car: 1 });
ReservationSchema.index({ clients: 1 });
ReservationSchema.index({ status: 1 });
ReservationSchema.index({ startDate: 1 });
