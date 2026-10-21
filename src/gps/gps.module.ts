import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GpsController } from './gps.controller';
import { GpsService } from './gps.service';
import { TraciPollerService } from './traci-poller.service';
import { WinnouPollerService } from './winnou-poller.service';
import { CarModule } from '../car/car.module';
import {
  CarPosition,
  CarPositionSchema,
} from './schemas/car-position.schema';
import {
  SpeedAlert,
  SpeedAlertSchema,
} from './schemas/speed-alert.schema';
import { Contrat, ContratSchema } from '../contrat/schemas/contrat.schema';
import { Setting, SettingSchema } from '../setting/schemas/setting.schema';

import { GpsLiveTrackerService } from './gps-live-tracker.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CarPosition.name, schema: CarPositionSchema },
      { name: SpeedAlert.name, schema: SpeedAlertSchema },
      { name: Contrat.name, schema: ContratSchema },
      { name: Setting.name, schema: SettingSchema },
    ]),
    CarModule,
  ],
  controllers: [GpsController],
  providers: [
    GpsService,
    TraciPollerService,
    WinnouPollerService,
    GpsLiveTrackerService,
  ],
  exports: [GpsService, GpsLiveTrackerService],
})
export class GpsModule {}
