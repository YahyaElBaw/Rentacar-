import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Contrat {
  @Prop({ required: true, unique: true })
  reference: string;

  @Prop({ type: Types.ObjectId, ref: 'Car', required: true })
  car: Types.ObjectId;

  @Prop([{ type: Types.ObjectId, ref: 'Client' }])
  clients: Types.ObjectId[];

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ default: 0 })
  totalAmount: number;

  @Prop({ default: 0 })
  depositAmount: number;

  @Prop({ default: 0 })
  carDailyRate: number;

  @Prop({ default: 'active', enum: ['soon', 'active', 'terminé', 'clôturé', 'cancelled'] })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop()
  notes: string;

  // Closure & Bilan Fields
  @Prop()
  startMileage: number;

  @Prop()
  returnMileage: number;

  @Prop()
  carStateAtReturn: string;

  @Prop()
  closureType: string;

  @Prop()
  closureNotes: string;

  @Prop({ default: false })
  isPaid: boolean;

  @Prop({ enum: ['espece', 'cheque'] })
  paymentMethod: string;

  @Prop()
  chequeNumber: string;

  @Prop()
  bankName: string;

  @Prop({ type: Types.ObjectId, ref: 'Reservation' })
  reservation: Types.ObjectId;

  @Prop({ default: 0 })
  contractTaxValue: number;

  @Prop({ default: 0 })
  tvaValue: number;
}

export type ContratDocument = Contrat & Document;
export const ContratSchema = SchemaFactory.createForClass(Contrat);


ContratSchema.index({ car: 1 });
ContratSchema.index({ status: 1 });
ContratSchema.index({ startDate: 1 });
ContratSchema.index({ endDate: 1 });
