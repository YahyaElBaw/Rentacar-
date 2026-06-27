import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Journee {
  @Prop({ required: true, unique: true })
  date: string; // YYYY-MM-DD

  @Prop({ default: 'open', enum: ['open', 'closed'] })
  status: string;

  @Prop([
    {
      entryType: { type: String, default: '' }, // new field going forward
      type: { type: String, default: '' },       // kept for reading old records
      description: { type: String, default: '' },
      amount: { type: Number, default: 0 },
      reference: { type: String, default: '' },
      time: { type: Date, default: Date.now }
    }
  ])
  entries: any[];

  @Prop({ default: 0 })
  totalDaily: number;
}

export type JourneeDocument = Journee & Document;
export const JourneeSchema = SchemaFactory.createForClass(Journee);

// Ensure index on date for fast retrieval
JourneeSchema.index({ date: 1 });
