import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReservationController } from './reservation.controller';
import { ReservationService } from './reservation.service';
import { Reservation, ReservationSchema } from './schemas/reservation.schema';
import { Contrat, ContratSchema } from '../contrat/schemas/contrat.schema';
import { CarModule } from '../car/car.module';
import { ClientModule } from '../client/client.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reservation.name, schema: ReservationSchema },
      { name: Contrat.name, schema: ContratSchema },
    ]),
    CarModule,
    ClientModule,
    UsersModule,
  ],
  controllers: [ReservationController],
  providers: [ReservationService],
  exports: [MongooseModule],
})
export class ReservationModule {}
