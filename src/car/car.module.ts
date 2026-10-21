import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { CarController } from './car.controller';
import { CarService } from './car.service';
import { Car, CarSchema } from './schemas/car.schema';
import { Reservation, ReservationSchema } from '../reservation/schemas/reservation.schema';
import { Contrat, ContratSchema } from '../contrat/schemas/contrat.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Car.name, schema: CarSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: Contrat.name, schema: ContratSchema },
    ]),
    UsersModule,
  ],
  controllers: [CarController],
  providers: [CarService],
  exports: [MongooseModule],
})
export class CarModule {}
