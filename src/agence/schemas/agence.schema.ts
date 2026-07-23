import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class TemplateField {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  label: string;

  @Prop({ required: true, default: 10 })
  x: number; // Percentage 0-100 from left

  @Prop({ required: true, default: 10 })
  y: number; // Percentage 0-100 from top

  @Prop({ default: 14 })
  fontSize: number;

  @Prop({ default: 'normal' })
  fontWeight: string;

  @Prop({ default: 'left' })
  alignment: string;

  @Prop({ default: '#000000' })
  color: string;

  @Prop({ default: '' })
  customValue: string;
}

@Schema({ timestamps: true })
export class Agence {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ default: '' })
  templateImage: string;

  @Prop({ default: false })
  printBackground: boolean;

  @Prop({ type: Array, default: [] })
  templateFields: TemplateField[];
}

export type AgenceDocument = Agence & Document;
export const AgenceSchema = SchemaFactory.createForClass(Agence);
