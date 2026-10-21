import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingConflictService } from './booking-conflict.service';
import {
  Reservation,
  ReservationSchema,
} from '../reservation/schemas/reservation.schema';
import { Contrat, ContratSchema } from '../contrat/schemas/contrat.schema';
import { Client, ClientSchema } from '../client/schemas/client.schema';

import { PdfService } from './pdf.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reservation.name, schema: ReservationSchema },
      { name: Contrat.name, schema: ContratSchema },
      { name: Client.name, schema: ClientSchema },
    ]),
  ],
  providers: [BookingConflictService, PdfService],
  exports: [BookingConflictService, PdfService],
})
export class SharedModule {}
