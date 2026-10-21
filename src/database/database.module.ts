import { Module } from '@nestjs/common';
import { DatabaseConfigService } from './database-config.service';
import { DatabaseReplicationService } from './database-replication.service';
import { DatabaseHealthService } from './database-health.service';
import { DatabaseController } from './database.controller';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [DatabaseController],
  providers: [
    DatabaseConfigService,
    DatabaseReplicationService,
    DatabaseHealthService,
  ],
  exports: [
    DatabaseConfigService,
    DatabaseReplicationService,
    DatabaseHealthService,
  ],
})
export class DatabaseModule {}
