import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Log {
  @Prop({ required: true })
  action: string;

  @Prop()
  actorId: string;

  @Prop()
  actorName: string;

  @Prop({ default: 'user' })
  role: string;

  @Prop()
  detail: string;
}

export type LogDocument = Log & Document;
export const LogSchema = SchemaFactory.createForClass(Log);

LogSchema.index({ createdAt: -1 });
LogSchema.index({ role: 1 });
LogSchema.index({ actorName: 1 });
