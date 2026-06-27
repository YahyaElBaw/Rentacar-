import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Depense {
  @Prop({ type: Types.ObjectId, ref: 'Car', required: false })
  car: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  category: string;

  @Prop()
  description: string;
}

export type DepenseDocument = Depense & Document;
export const DepenseSchema = SchemaFactory.createForClass(Depense);

DepenseSchema.index({ car: 1 });
DepenseSchema.index({ date: 1 });
DepenseSchema.index({ category: 1 });
