import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Reservation, ReservationDocument } from './schemas/reservation.schema';
import { Car, CarDocument } from '../car/schemas/car.schema';
import { Client, ClientDocument } from '../client/schemas/client.schema';
import { Contrat, ContratDocument } from '../contrat/schemas/contrat.schema';

import { BookingConflictService } from '../shared/booking-conflict.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class ReservationService {
  constructor(
    @InjectModel(Reservation.name)
    private reservationModel: Model<ReservationDocument>,
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    @InjectModel(Contrat.name) private contratModel: Model<ContratDocument>,
    private bookingConflictService: BookingConflictService,
    private eventsGateway: EventsGateway,
  ) {}

  private async normalizeClientData(res: any): Promise<void> {
    if (!res) return;

    // Support for both lean objects and Mongoose Documents
    const clientsField = res.clients;
    const legacyClientField = res.get ? res.get('client') : res.client;

    const rawClients =
      clientsField && Array.isArray(clientsField) && clientsField.length > 0
        ? clientsField
        : legacyClientField
          ? [legacyClientField]
          : [];

    const normalizedClients = [];
    for (const c of rawClients) {
      if (
        c &&
        typeof c === 'object' &&
        (c.lastName || (c.get && c.get('lastName')))
      ) {
        normalizedClients.push(c);
      } else if (c) {
        try {
          const clientObj = await this.clientModel.findById(c).lean().exec();
          if (clientObj) normalizedClients.push(clientObj);
        } catch (err) {
          console.error(`Failed to manually populate client ${c}`, err);
        }
      }
    }

    if (res.set) {
      // Mongoose Document: use set for virtual-like properties if needed,
      // or just assign to 'any' for the response
      res.clients = normalizedClients;
    } else {
      res.clients = normalizedClients;
    }
  }

  async create(createReservationDto: any): Promise<ReservationDocument> {
    // Standardize client(singular) to clients(array) for the schema
    if (createReservationDto.client && !createReservationDto.clients) {
      createReservationDto.clients = [createReservationDto.client];
    }

    let car = null;
    if (createReservationDto.car) {
      car = await this.carModel.findById(createReservationDto.car).exec();
      if (!car) throw new NotFoundException('Car not found');

      const start = new Date(createReservationDto.startDate);
      const end = new Date(createReservationDto.endDate);

      const conflicts = await this.bookingConflictService.findConflicts(
        createReservationDto.car,
        start,
        end,
      );

      if (conflicts.hasConflicts && createReservationDto.force !== true) {
        throw new ConflictException({
          message: 'CAR_RESERVED_CONFLICT',
          conflicts: {
            reservations: conflicts.reservations,
            contracts: conflicts.contracts,
          },
        });
      }

      if (createReservationDto.force && conflicts.reservations.length > 0) {
        await this.reservationModel
          .updateMany(
            { _id: { $in: conflicts.reservations.map((c) => c._id) } },
            { status: 'pending' },
          )
          .exec();
      }
    }

    const createdReservation = new this.reservationModel(
      createReservationDto,
    ) as ReservationDocument;
    const savedReservation = await createdReservation.save();

    this.eventsGateway.broadcastDataChange('reservation:change', {
      action: 'created',
      id: savedReservation._id,
    });

    return savedReservation;
  }

  async findAll(filters: any = {}): Promise<any[]> {
    const query: any = {};
    if (filters.status) query['status'] = filters.status;
    if (filters.carId) query['car'] = filters.carId;
    if (filters.clientId) {
      query['$or'] = [
        { clients: filters.clientId },
        { client: filters.clientId },
      ];
    }

    const list = await this.reservationModel
      .find(query)
      .select('startDate endDate status car clients client dailyRate notes createdAt contrat')
      .populate({ path: 'car', model: 'Car', select: 'brand model matricule color dailyRate' })
      .populate({ path: 'clients', model: 'Client', select: 'firstName lastName cin phone' })
      .populate({ path: 'contrat', model: 'Contrat', select: 'reference status' })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    // Collect any unpopulated client IDs to batch-fetch in 1 single query
    const missingClientIds = new Set<string>();
    for (const res of list as any[]) {
      const rawClients = res.clients && Array.isArray(res.clients) && res.clients.length > 0
        ? res.clients
        : res.client ? [res.client] : [];
      for (const c of rawClients) {
        if (c && (typeof c !== 'object' || !c.lastName)) {
          const id = typeof c === 'object' ? c._id?.toString() : c.toString();
          if (id) missingClientIds.add(id);
        }
      }
    }

    let clientsMap = new Map<string, any>();
    if (missingClientIds.size > 0) {
      try {
        const fetched = await this.clientModel
          .find({ _id: { $in: Array.from(missingClientIds) } })
          .select('firstName lastName cin phone')
          .lean()
          .exec();
        for (const cl of fetched) {
          clientsMap.set(cl._id.toString(), cl);
        }
      } catch (err) {
        console.error('Failed to batch load clients for reservations', err);
      }
    }

    // In-memory assignment: 0 extra network calls!
    for (const res of list as any[]) {
      const rawClients = res.clients && Array.isArray(res.clients) && res.clients.length > 0
        ? res.clients
        : res.client ? [res.client] : [];

      const normalized: any[] = [];
      for (const c of rawClients) {
        if (c && typeof c === 'object' && c.lastName) {
          normalized.push(c);
        } else if (c) {
          const id = typeof c === 'object' ? c._id?.toString() : c.toString();
          const found = clientsMap.get(id);
          if (found) normalized.push(found);
        }
      }
      res.clients = normalized;
      const firstClient = normalized[0];
      res.clientName = firstClient
        ? `${firstClient.lastName} ${firstClient.firstName}`.trim().toUpperCase()
        : '—';
      res.clientPhone = firstClient ? firstClient.phone || 'Pas de tél' : 'Pas de tél';
      res.clientCin = firstClient ? firstClient.cin || '—' : '—';
    }
    return list;
  }

  async findOne(id: string): Promise<any> {
    const reservation = await this.reservationModel
      .findById(id)
      .populate({ path: 'car', model: 'Car' })
      .populate({ path: 'clients', model: 'Client' })
      .populate('contrat')
      .exec();
    if (!reservation)
      throw new NotFoundException(`Reservation with ID ${id} not found`);

    await this.normalizeClientData(reservation);
    const firstClient = (reservation as any).clients?.[0];
    (reservation as any).clientName = firstClient
      ? `${firstClient.lastName} ${firstClient.firstName}`.trim().toUpperCase()
      : '—';
    (reservation as any).clientPhone = firstClient
      ? firstClient.phone || 'Pas de tél'
      : 'Pas de tél';

    return reservation;
  }

  async update(id: string, updateDto: any): Promise<any> {
    const reservation = await this.reservationModel
      .findByIdAndUpdate(id, updateDto, { new: true })
      .populate({ path: 'car', model: 'Car' })
      .populate({ path: 'clients', model: 'Client' })
      .exec();
    if (!reservation)
      throw new NotFoundException(`Reservation with ID ${id} not found`);

    await this.normalizeClientData(reservation);
    const firstClient = (reservation as any).clients?.[0];
    (reservation as any).clientName = firstClient
      ? `${firstClient.lastName} ${firstClient.firstName}`.trim().toUpperCase()
      : '—';
    (reservation as any).clientPhone = firstClient
      ? firstClient.phone || 'Pas de tél'
      : 'Pas de tél';

    this.eventsGateway.broadcastDataChange('reservation:change', {
      action: 'updated',
      id,
    });

    return reservation;
  }

  async confirm(id: string, force = false): Promise<ReservationDocument> {
    const reservation = await this.findOne(id);
    if (reservation.status !== 'pending')
      throw new BadRequestException(
        'Only pending reservations can be confirmed',
      );

    if (!reservation.car)
      throw new BadRequestException('A car must be assigned before confirming');

    const car = await this.carModel.findById(reservation.car).exec();
    if (!car) throw new NotFoundException('Car not found');

    // Precision Conflict Check for the reservation period
    const conflicts = await this.bookingConflictService.findConflicts(
      car._id.toString(),
      reservation.startDate,
      reservation.endDate,
      reservation._id.toString(),
    );

    if (conflicts.hasConflicts && force !== true) {
      throw new ConflictException({
        message: 'CAR_RESERVED_CONFLICT',
        conflicts: {
          reservations: conflicts.reservations,
          contracts: conflicts.contracts,
        },
      });
    }

    if (force && conflicts.reservations.length > 0) {
      await this.reservationModel
        .updateMany(
          { _id: { $in: conflicts.reservations.map((c) => c._id) } },
          { status: 'pending' },
        )
        .exec();
    }

    reservation.status = 'confirmed';
    await reservation.save();

    this.eventsGateway.broadcastDataChange('reservation:change', {
      action: 'confirmed',
      id,
    });

    return reservation;
  }

  async cancel(id: string): Promise<ReservationDocument> {
    const reservation = await this.findOne(id);
    reservation.status = 'cancelled';
    await reservation.save();

    this.eventsGateway.broadcastDataChange('reservation:change', {
      action: 'cancelled',
      id,
    });

    return reservation;
  }

  async forceDelete(id: string): Promise<{ deleted: boolean }> {
    const result = await this.reservationModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Reservation with ID ${id} not found`);
    }

    this.eventsGateway.broadcastDataChange('reservation:change', {
      action: 'deleted',
      id,
    });

    return { deleted: true };
  }

  async updateStatus(
    id: string,
    status: string,
    contratId?: string,
  ): Promise<ReservationDocument> {
    const validStatuses = ['pending', 'confirmed', 'cancelled', 'converted'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Statut invalide: ${status}`);
    }

    const reservation = await this.reservationModel.findById(id).exec();
    if (!reservation) {
      throw new NotFoundException(`Reservation with ID ${id} not found`);
    }

    if (status === 'converted') {
      if (!contratId) {
        throw new BadRequestException(
          'Un contrat doit être sélectionné pour le statut "converted"',
        );
      }
      const contrat = await this.contratModel.findById(contratId).exec();
      if (!contrat) {
        throw new NotFoundException(`Contract with ID ${contratId} not found`);
      }
      reservation.contrat = contrat._id as any;
      // Bidirectional link
      await this.contratModel
        .findByIdAndUpdate(contratId, { $set: { reservation: reservation._id } })
        .exec();
    }

    reservation.status = status;
    await reservation.save();

    this.eventsGateway.broadcastDataChange('reservation:change', {
      action: 'status-changed',
      id,
      status,
    });

    return this.findOne(id);
  }
}
