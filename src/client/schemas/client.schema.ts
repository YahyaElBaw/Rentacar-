import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Client {
  @Prop({ type: Types.ObjectId, ref: 'User' })
  addedBy: Types.ObjectId;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop()
  birthday: Date;

  @Prop({ default: 'cin', enum: ['cin', 'passport', 'carte_sejour'] })
  idCardType: string;

  @Prop({ required: true, unique: true })
  cin: string;

  @Prop({ required: true, unique: true })
  drivingLicense: string;

  @Prop()
  cinDate: Date;

  @Prop()
  licenseDate: Date;

  @Prop({ required: true })
  phone: string;

  @Prop()
  email: string;

  @Prop()
  address: string;

  @Prop({ default: 'WHITE_LIST', enum: ['WHITE_LIST', 'BLACK_LIST', 'BLOCK_LIST'] })
  status: string;

  @Prop()
  description: string;

  @Prop()
  cinFront: string;

  @Prop()
  cinBack: string;

  @Prop()
  licenseFront: string;

  @Prop()
  licenseBack: string;

  @Prop({ default: 0 })
  totalRents: number;

  @Prop({ default: false })
  disabled: boolean;
}

export type ClientDocument = Client & Document;
export const ClientSchema = SchemaFactory.createForClass(Client);


ClientSchema.index({ lastName: 1 });
ClientSchema.index({ totalRents: -1 });
