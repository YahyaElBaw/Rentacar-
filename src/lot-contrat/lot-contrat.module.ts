import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LotContrat, LotContratSchema } from './schemas/lot-contrat.schema';
import { Contrat, ContratSchema } from '../contrat/schemas/contrat.schema';
import { Car, CarSchema } from '../car/schemas/car.schema';
import { Client, ClientSchema } from '../client/schemas/client.schema';
import { Agence, AgenceSchema } from '../agence/schemas/agence.schema';
import { DepenseModule } from '../depense/depense.module';
import { SettingModule } from '../setting/setting.module';
import { LotContratService } from './lot-contrat.service';
import { LotContratController } from './lot-contrat.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LotContrat.name, schema: LotContratSchema },
      { name: Contrat.name, schema: ContratSchema },
      { name: Car.name, schema: CarSchema },
      { name: Client.name, schema: ClientSchema },
      { name: Agence.name, schema: AgenceSchema },
    ]),
    DepenseModule,
    SettingModule,
  ],
  controllers: [LotContratController],
  providers: [LotContratService],
  exports: [LotContratService],
})
export class LotContratModule {}
