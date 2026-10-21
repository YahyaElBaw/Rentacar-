import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class LotContrat {
  @Prop({ required: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Agence', required: true })
  agence: Types.ObjectId;

  @Prop({ required: true })
  startNumber: number;

  @Prop({ required: true })
  endNumber: number;

  @Prop({ required: true })
  currentNumber: number;

  @Prop({ default: 6 })
  numberPadding: number;

  @Prop({ default: 'ouvert', enum: ['ouvert', 'ferme'] })
  status: string;

  @Prop({ default: '' })
  notes: string;

  @Prop([{ type: Types.ObjectId, ref: 'Contrat', default: [] }])
  contrats: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'Depense', required: false })
  timbreDepense?: Types.ObjectId;

  @Prop({ default: 0 })
  timbreAmount?: number;

  @Prop({ default: 0 })
  totalRentedDays?: number;
}

export type LotContratDocument = LotContrat & Document;
export const LotContratSchema = SchemaFactory.createForClass(LotContrat);

LotContratSchema.index({ agence: 1, status: 1 });
LotContratSchema.index({ status: 1 });
