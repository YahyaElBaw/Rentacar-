import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DepenseController } from './depense.controller';
import { DepenseService } from './depense.service';
import { Depense, DepenseSchema } from './schemas/depense.schema';
import { CarModule } from '../car/car.module';
import { JourneeModule } from '../journee/journee.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Depense.name, schema: DepenseSchema }]),
    CarModule,
    JourneeModule,
    UsersModule,
  ],
  controllers: [DepenseController],
  providers: [DepenseService],
  exports: [MongooseModule],
})
export class DepenseModule {}
