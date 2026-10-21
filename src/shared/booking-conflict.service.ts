import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Reservation,
  ReservationDocument,
} from '../reservation/schemas/reservation.schema';
import { Contrat, ContratDocument } from '../contrat/schemas/contrat.schema';
import { Client } from '../client/schemas/client.schema';

@Injectable()
export class BookingConflictService {
  constructor(
    @InjectModel(Reservation.name)
    private reservationModel: Model<ReservationDocument>,
    @InjectModel(Contrat.name) private contratModel: Model<ContratDocument>,
    @InjectModel(Client.name) private clientModel: Model<any>,
  ) {}

  private async normalizeClients(docs: any[]) {
    const missingIds = docs
      .filter((d) => (!d.clients || d.clients.length === 0) && d.client)
      .map((d) => d.client);

    if (missingIds.length > 0) {
      try {
        const clientObjs = await this.clientModel
          .find({ _id: { $in: missingIds } })
          .select('firstName lastName cin phone')
          .lean()
          .exec();
        const map = new Map(clientObjs.map((c: any) => [c._id.toString(), c]));
        for (const doc of docs) {
          if ((!doc.clients || doc.clients.length === 0) && doc.client) {
            const found = map.get(doc.client.toString());
            if (found) doc.clients = [found];
          }
        }
      } catch (e) {}
    }
  }

  async findConflicts(
    carId: string,
    start: Date,
    end: Date,
    excludeReservationId?: string,
    excludeContractId?: string,
  ) {
    // Overlapping logic: (start < existing_end) AND (end > existing_start)

    // 1. Find Conflicting Reservations
    const reservationQuery: any = {
      car: carId,
      status: { $in: ['confirmed', 'pending'] },
      startDate: { $lt: end },
      endDate: { $gt: start },
    };
    if (excludeReservationId) {
      reservationQuery._id = { $ne: excludeReservationId };
    }
    const reservations = await this.reservationModel
      .find(reservationQuery)
      .populate('clients')
      .lean()
      .exec();
    await this.normalizeClients(reservations);

    // 2. Find Conflicting Contracts
    const contractQuery: any = {
      car: carId,
      status: { $in: ['active', 'soon'] },
      isDeleted: { $ne: true },
      startDate: { $lt: end },
      endDate: { $gt: start },
    };
    if (excludeContractId) {
      contractQuery._id = { $ne: excludeContractId };
    }
    const contracts = await this.contratModel
      .find(contractQuery)
      .populate('clients')
      .lean()
      .exec();
    await this.normalizeClients(contracts);

    return {
      reservations,
      contracts,
      hasConflicts: reservations.length > 0 || contracts.length > 0,
    };
  }
}
