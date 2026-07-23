import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agence, AgenceSchema } from './schemas/agence.schema';
import { AgenceService } from './agence.service';
import { AgenceController } from './agence.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Agence.name, schema: AgenceSchema }]),
  ],
  controllers: [AgenceController],
  providers: [AgenceService],
  exports: [AgenceService],
})
export class AgenceModule {}
