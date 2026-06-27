import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReservationController } from './reservation.controller';
import { ReservationService } from './reservation.service';
import { Reservation, ReservationSchema } from './schemas/reservation.schema';
import { CarModule } from '../car/car.module';
import { JourneeModule } from '../journee/journee.module';
import { ClientModule } from '../client/client.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Reservation.name, schema: ReservationSchema }]),
    CarModule,
    JourneeModule,
    ClientModule,
  ],
  controllers: [ReservationController],
  providers: [ReservationService],
  exports: [MongooseModule],
})
export class ReservationModule {}
