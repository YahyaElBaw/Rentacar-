import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { CarModule } from '../car/car.module';
import { ContratModule } from '../contrat/contrat.module';
import { ReservationModule } from '../reservation/reservation.module';
import { ClientModule } from '../client/client.module';
import { VisiteModule } from '../visite/visite.module';
import { VidangeModule } from '../vidange/vidange.module';
import { DepenseModule } from '../depense/depense.module';

@Module({
  imports: [
    CarModule,
    ContratModule,
    ReservationModule,
    ClientModule,
    VisiteModule,
    VidangeModule,
    DepenseModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
