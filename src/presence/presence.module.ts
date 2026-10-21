import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Presence, PresenceSchema } from './presence.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Presence.name, schema: PresenceSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
