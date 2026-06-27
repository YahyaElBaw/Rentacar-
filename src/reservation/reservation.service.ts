import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Reservation, ReservationDocument } from './schemas/reservation.schema';
import { Car, CarDocument } from '../car/schemas/car.schema';
import { Client, ClientDocument } from '../client/schemas/client.schema';

import { JourneeService } from '../journee/journee.service';
import { BookingConflictService } from '../shared/booking-conflict.service';

@Injectable()
export class ReservationService {
  constructor(
    @InjectModel(Reservation.name) private reservationModel: Model<ReservationDocument>,
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    private journeeService: JourneeService,
    private bookingConflictService: BookingConflictService,
  ) {}

  private async normalizeClientData(res: any): Promise<void> {
    if (!res) return;
    
    // Support for both lean objects and Mongoose Documents
    const clientsField = res.clients;
    const legacyClientField = res.get ? res.get('client') : res.client;

    const rawClients = (clientsField && Array.isArray(clientsField) && clientsField.length > 0) 
      ? clientsField 
      : (legacyClientField ? [legacyClientField] : []);

    const normalizedClients = [];
    for (const c of rawClients) {
      if (c && typeof c === 'object' && (c.lastName || (c.get && c.get('lastName')))) {
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
      (res as any).clients = normalizedClients;
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
        end
      );

      if (conflicts.hasConflicts && createReservationDto.force !== true) {
        throw new ConflictException({
          message: 'CAR_RESERVED_CONFLICT',
          conflicts: {
            reservations: conflicts.reservations,
            contracts: conflicts.contracts
          }
        });
      }

      if (createReservationDto.force && conflicts.reservations.length > 0) {
        await this.reservationModel.updateMany(
          { _id: { $in: conflicts.reservations.map(c => c._id) } },
          { status: 'pending' }
        ).exec();
      }
    }

    const createdReservation = new this.reservationModel(createReservationDto) as ReservationDocument;
    const savedReservation = await createdReservation.save();

    // Log to Journee
    const logMessage = car 
      ? `Nouvelle réservation pour ${car.brand} ${car.model}`
      : `Nouvelle réservation (Véhicule non assigné)`;

    await this.journeeService.addEntry(
      'RESERVATION_PRISE',
      logMessage,
      0,
      savedReservation._id.toString()
    );

    return savedReservation;
  }

  async findAll(filters: any = {}): Promise<any[]> {
    const query: any = {};
    if (filters.status) query['status'] = filters.status;
    if (filters.carId) query['car'] = filters.carId;
    if (filters.clientId) {
      query['$or'] = [
        { clients: filters.clientId },
        { client: filters.clientId }
      ];
    }

    const list = await this.reservationModel.find(query)
      .populate({ path: 'car', model: 'Car' })
      .populate({ path: 'clients', model: 'Client' })
      .populate('contrat')
      .lean()
      .exec();

    for (const res of list as any[]) {
      await this.normalizeClientData(res);
      const firstClient = res.clients?.[0] as any;
      res.clientName = firstClient ? `${firstClient.lastName} ${firstClient.firstName}`.trim().toUpperCase() : '—';
      res.clientPhone = firstClient ? (firstClient.phone || 'Pas de tél') : 'Pas de tél';
      res.clientCin = firstClient ? (firstClient.cin || '—') : '—';
    }
    return list;
  }

  async findOne(id: string): Promise<any> {
    const reservation = await this.reservationModel.findById(id)
      .populate({ path: 'car', model: 'Car' })
      .populate({ path: 'clients', model: 'Client' })
      .populate('contrat')
      .exec();
    if (!reservation) throw new NotFoundException(`Reservation with ID ${id} not found`);
    
    await this.normalizeClientData(reservation);
    const firstClient = (reservation as any).clients?.[0] as any;
    (reservation as any).clientName = firstClient ? `${firstClient.lastName} ${firstClient.firstName}`.trim().toUpperCase() : '—';
    (reservation as any).clientPhone = firstClient ? (firstClient.phone || 'Pas de tél') : 'Pas de tél';
    
    return reservation;
  }

  async update(id: string, updateDto: any): Promise<any> {
    const reservation = await this.reservationModel
      .findByIdAndUpdate(id, updateDto, { new: true })
      .populate({ path: 'car', model: 'Car' })
      .populate({ path: 'clients', model: 'Client' })
      .exec();
    if (!reservation) throw new NotFoundException(`Reservation with ID ${id} not found`);
    
    await this.normalizeClientData(reservation);
    const firstClient = (reservation as any).clients?.[0] as any;
    (reservation as any).clientName = firstClient ? `${firstClient.lastName} ${firstClient.firstName}`.trim().toUpperCase() : '—';
    (reservation as any).clientPhone = firstClient ? (firstClient.phone || 'Pas de tél') : 'Pas de tél';

    return reservation;
  }

  async confirm(id: string, force = false): Promise<ReservationDocument> {
    const reservation = await this.findOne(id);
    if (reservation.status !== 'pending') throw new BadRequestException('Only pending reservations can be confirmed');

    if (!reservation.car) throw new BadRequestException('A car must be assigned before confirming');

    const car = await this.carModel.findById(reservation.car).exec();
    if (!car) throw new NotFoundException('Car not found');

    // Precision Conflict Check for the reservation period
    const conflicts = await this.bookingConflictService.findConflicts(
      car._id.toString(),
      reservation.startDate,
      reservation.endDate,
      reservation._id.toString()
    );

    if (conflicts.hasConflicts && force !== true) {
       throw new ConflictException({
         message: 'CAR_RESERVED_CONFLICT',
         conflicts: {
           reservations: conflicts.reservations,
           contracts: conflicts.contracts
         }
       });
    }

    if (force && conflicts.reservations.length > 0) {
      await this.reservationModel.updateMany(
        { _id: { $in: conflicts.reservations.map(c => c._id) } },
        { status: 'pending' }
      ).exec();
    }

    reservation.status = 'confirmed';
    await reservation.save();

    return reservation;
  }

  async cancel(id: string): Promise<ReservationDocument> {
    const reservation = await this.findOne(id);
    reservation.status = 'cancelled';
    await reservation.save();

    return reservation;
  }
}
