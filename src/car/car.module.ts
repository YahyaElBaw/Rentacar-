import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { CarController } from './car.controller';
import { CarService } from './car.service';
import { Car, CarSchema } from './schemas/car.schema';
import { Reservation, ReservationSchema } from '../reservation/schemas/reservation.schema';
import { Contrat, ContratSchema } from '../contrat/schemas/contrat.schema';
import { Visite, VisiteSchema } from '../visite/schemas/visite.schema';
import { Vidange, VidangeSchema } from '../vidange/schemas/vidange.schema';
import { Depense, DepenseSchema } from '../depense/schemas/depense.schema';
import { Agence, AgenceSchema } from '../agence/schemas/agence.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Car.name, schema: CarSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: Contrat.name, schema: ContratSchema },
      { name: Visite.name, schema: VisiteSchema },
      { name: Vidange.name, schema: VidangeSchema },
      { name: Depense.name, schema: DepenseSchema },
      { name: Agence.name, schema: AgenceSchema },
    ]),
    UsersModule,
  ],
  controllers: [CarController],
  providers: [CarService],
  exports: [MongooseModule],
})
export class CarModule {}
