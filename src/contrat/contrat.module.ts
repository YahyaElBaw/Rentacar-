import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContratController } from './contrat.controller';
import { ContratService } from './contrat.service';
import { Contrat, ContratSchema } from './schemas/contrat.schema';
import { CarModule } from '../car/car.module';
import { ClientModule } from '../client/client.module';
import { UsersModule } from '../users/users.module';
import { JourneeModule } from '../journee/journee.module';
import { ReservationModule } from '../reservation/reservation.module';
// Removed PdfService import - now provided by SharedModule
import { SettingModule } from '../setting/setting.module';
import { DepenseModule } from '../depense/depense.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Contrat.name, schema: ContratSchema }]),
    CarModule,
    ClientModule,
    UsersModule,
    JourneeModule,
    ReservationModule,
    SettingModule,
    DepenseModule,
  ],
  controllers: [ContratController],
  providers: [ContratService],
  exports: [MongooseModule],
})
export class ContratModule {}
