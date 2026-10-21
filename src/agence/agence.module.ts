import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { Agence, AgenceSchema } from './schemas/agence.schema';
import { AgenceService } from './agence.service';
import { AgenceController } from './agence.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Agence.name, schema: AgenceSchema }]),
    UsersModule,
  ],
  controllers: [AgenceController],
  providers: [AgenceService],
  exports: [AgenceService],
})
export class AgenceModule {}
