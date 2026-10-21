import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class CarDocumentItem {
  @Prop({ required: true })
  type: string; // carteGriseRecto | carteGriseVerso | laisserPasser | assurance | vignette

  @Prop({ required: true })
  url: string;

  @Prop({ default: '' })
  originalName: string;

  @Prop({ default: () => new Date() })
  uploadedAt: Date;
}

export const CarDocumentItemSchema =
  SchemaFactory.createForClass(CarDocumentItem);

@Schema({ timestamps: true })
export class Car {
  @Prop({ required: true, unique: true })
  matricule: string;

  @Prop({ required: true })
  brand: string;

  @Prop({ required: true })
  model: string;

  @Prop()
  color: string;

  @Prop()
  departureDate: Date;

  @Prop()
  nextTechnicalVisitDate: Date;

  @Prop()
  nextOilChangeMileage: number;

  @Prop()
  insuranceDate: Date;

  @Prop({ default: false })
  disabled: boolean;

  @Prop({ default: '' })
  gpsImei: string;

  @Prop({ default: '' })
  gpsProvider: string;

  @Prop({ required: true })
  dailyRate: number;

  @Prop({ required: true })
  mileage: number;

  @Prop({ default: true })
  isAvailable: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Agence' })
  agence: Types.ObjectId;

  @Prop({ type: [CarDocumentItemSchema], default: [] })
  documents: CarDocumentItem[];

  @Prop([{ type: Types.ObjectId, ref: 'Reservation' }])
  reservations: Types.ObjectId[];

  @Prop([{ type: Types.ObjectId, ref: 'Visite' }])
  visites: Types.ObjectId[];

  @Prop([{ type: Types.ObjectId, ref: 'Vidange' }])
  vidanges: Types.ObjectId[];

  @Prop([{ type: Types.ObjectId, ref: 'Depense' }])
  depenses: Types.ObjectId[];
}

export type CarDocument = Car & Document;
export const CarSchema = SchemaFactory.createForClass(Car);

CarSchema.index({ brand: 1 });
CarSchema.index({ isAvailable: 1 });
CarSchema.index({ disabled: 1 });
CarSchema.index({ disabled: 1, isAvailable: 1 });
