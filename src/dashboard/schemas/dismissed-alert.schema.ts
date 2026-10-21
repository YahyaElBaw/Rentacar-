import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class DismissedAlert {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  dismissedBy: Types.ObjectId;

  @Prop({ default: '' })
  code: string;

  @Prop({ default: '' })
  type: string;

  @Prop({ default: '' })
  message: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export type DismissedAlertDocument = DismissedAlert & Document;
export const DismissedAlertSchema =
  SchemaFactory.createForClass(DismissedAlert);
