import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Journee, JourneeSchema } from './schemas/journee.schema';
import { JourneeService } from './journee.service';
import { JourneeController } from './journee.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Journee.name, schema: JourneeSchema }]),
    UsersModule,
  ],
  controllers: [JourneeController],
  providers: [JourneeService],
  exports: [JourneeService],
})
export class JourneeModule {}
