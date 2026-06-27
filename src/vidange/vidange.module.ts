import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VidangeController } from './vidange.controller';
import { VidangeService } from './vidange.service';
import { Vidange, VidangeSchema } from './schemas/vidange.schema';
import { CarModule } from '../car/car.module';
import { DepenseModule } from '../depense/depense.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Vidange.name, schema: VidangeSchema }]),
    CarModule,
    DepenseModule,
  ],
  controllers: [VidangeController],
  providers: [VidangeService],
  exports: [MongooseModule],
})
export class VidangeModule {}
