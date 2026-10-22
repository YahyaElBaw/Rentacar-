import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CarModule } from './car/car.module';
import { ClientModule } from './client/client.module';
import { ContratModule } from './contrat/contrat.module';
import { ReservationModule } from './reservation/reservation.module';
import { VisiteModule } from './visite/visite.module';
import { VidangeModule } from './vidange/vidange.module';
import { DepenseModule } from './depense/depense.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { GpsModule } from './gps/gps.module';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { UploadModule } from './upload/upload.module';
import { SharedModule } from './shared/shared.module';
import { SettingModule } from './setting/setting.module';
import { AgenceModule } from './agence/agence.module';
import { LotContratModule } from './lot-contrat/lot-contrat.module';
import { LogModule } from './log/log.module';
import { EventsModule } from './events/events.module';
import { PresenceModule } from './presence/presence.module';
import { PresenceInterceptor } from './presence/presence.interceptor';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri:
          config.get<string>('MONGODB_URI') || 'mongodb://127.0.0.1:27017/rentacar',
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        maxPoolSize: 10, // Optimized for MongoDB Atlas M0 (Free Tier max 500 connections)
        minPoolSize: 1,
        maxIdleTimeMS: 30000, // Automatically close idle sockets after 30s
      }),
    }),
    DatabaseModule,
    EventsModule,
    PresenceModule,
    SharedModule,
    CarModule,
    ClientModule,
    ContratModule,
    ReservationModule,
    VisiteModule,
    VidangeModule,
    DepenseModule,
    DashboardModule,
    GpsModule,
    AuthModule,
    UsersModule,
    UploadModule,
    SettingModule,
    AgenceModule,
    LotContratModule,
    LogModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: PresenceInterceptor },
  ],
})
export class AppModule {}

