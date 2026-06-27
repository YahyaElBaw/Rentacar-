import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VisiteController } from './visite.controller';
import { VisiteService } from './visite.service';
import { Visite, VisiteSchema } from './schemas/visite.schema';
import { CarModule } from '../car/car.module';
import { DepenseModule } from '../depense/depense.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Visite.name, schema: VisiteSchema }]),
    CarModule,
    DepenseModule,
  ],
  controllers: [VisiteController],
  providers: [VisiteService],
  exports: [MongooseModule],
})
export class VisiteModule {}
