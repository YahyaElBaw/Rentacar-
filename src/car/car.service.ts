import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Car, CarDocument } from './schemas/car.schema';
import { Reservation, ReservationDocument } from '../reservation/schemas/reservation.schema';
import { Contrat, ContratDocument } from '../contrat/schemas/contrat.schema';
import { Visite, VisiteDocument } from '../visite/schemas/visite.schema';
import { Depense, DepenseDocument } from '../depense/schemas/depense.schema';
import { BookingConflictService } from '../shared/booking-conflict.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class CarService {
  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    @InjectModel(Reservation.name) private reservationModel: Model<ReservationDocument>,
    @InjectModel(Contrat.name) private contratModel: Model<ContratDocument>,
    @InjectModel(Visite.name) private visiteModel: Model<VisiteDocument>,
    @InjectModel(Depense.name) private depenseModel: Model<DepenseDocument>,
    private readonly bookingConflictService: BookingConflictService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async create(createCarDto: any): Promise<CarDocument> {
    const createdCar = new this.carModel(createCarDto) as CarDocument;
    const savedCar = await createdCar.save();
    this.eventsGateway.broadcastDataChange('car:change', {
      action: 'created',
      carId: savedCar._id,
    });
    return savedCar;
  }

  async findAvailable(startDate: Date, endDate: Date): Promise<CarDocument[]> {
    // Run all 3 queries in parallel: cars + reservations + contracts
    const [allCars, bookedByReservation, bookedByContract] = await Promise.all([
      this.carModel
        .find({ disabled: { $ne: true } })
        .select('brand model matricule color dailyRate mileage isAvailable agence category departureDate nextTechnicalVisitDate nextOilChangeMileage insuranceDate disabled createdAt')
        .lean()
        .exec(),
      this.reservationModel
        .distinct('car', {
          status: { $in: ['confirmed', 'pending'] },
          startDate: { $lt: endDate },
          endDate: { $gt: startDate },
        })
        .exec(),
      this.contratModel
        .distinct('car', {
          status: { $in: ['active', 'soon'] },
          startDate: { $lt: endDate },
          endDate: { $gt: startDate },
        })
        .exec(),
    ]);

    const bookedIds = new Set<string>();
    for (const id of [...bookedByReservation, ...bookedByContract]) {
      if (id) bookedIds.add(id.toString());
    }

    return allCars.filter(car => !bookedIds.has((car as any)._id.toString()));
  }

  async findAll(filters: any = {}): Promise<CarDocument[]> {
    const query: any = {};

    if (filters.disabled === 'true') {
      query.disabled = true;
    } else {
      query.disabled = { $ne: true };
    }

    if (filters.brand) query['brand'] = new RegExp(filters.brand, 'i');
    if (filters.category) query['category'] = filters.category;
    if (filters.isAvailable !== undefined)
      query['isAvailable'] = filters.isAvailable;

    let cars = await this.carModel
      .find(query)
      .select('brand model matricule color dailyRate mileage isAvailable agence category departureDate nextTechnicalVisitDate nextOilChangeMileage insuranceDate disabled documents createdAt')
      .populate('agence', 'name')
      .lean()
      .exec();

    if (filters.isAvailable) {
      // Batch approach: single aggregation to get all booked car IDs for today
      // instead of firing 2 queries per car in a loop (N+1 anti-pattern)
      const bookedCarIds = await this.getBookedCarIdsToday();
      cars = cars.filter(car => !bookedCarIds.has((car as any)._id.toString()));
    }

    return cars as any;
  }

  /**
   * Returns a Set of car IDs that have active bookings (contracts or reservations)
   * overlapping today. Uses 2 aggregations instead of 2N per-car queries.
   */
  private async getBookedCarIdsToday(): Promise<Set<string>> {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const dateOverlapFilter = {
      startDate: { $lt: endOfDay },
      endDate: { $gt: startOfDay },
    };

    const [bookedByReservation, bookedByContract] = await Promise.all([
      this.reservationModel
        .distinct('car', {
          status: { $in: ['confirmed', 'pending'] },
          ...dateOverlapFilter,
        })
        .exec(),
      this.contratModel
        .distinct('car', {
          status: { $in: ['active', 'soon'] },
          ...dateOverlapFilter,
        })
        .exec(),
    ]);

    const ids = new Set<string>();
    for (const id of [...bookedByReservation, ...bookedByContract]) {
      ids.add(id.toString());
    }
    return ids;
  }

  async findOne(id: string): Promise<any> {
    const [car, contrats, visites, depenses, reservations] = await Promise.all([
      this.carModel
        .findById(id)
        .populate('agence', 'name')
        .populate('vidanges')
        .lean()
        .exec(),
      this.contratModel
        .find({ car: id, isDeleted: { $ne: true } })
        .populate({ path: 'clients', model: 'Client', select: 'firstName lastName cin phone' })
        .sort({ startDate: -1 })
        .lean()
        .exec(),
      this.visiteModel
        .find({ car: id })
        .sort({ date: -1 })
        .lean()
        .exec(),
      this.depenseModel
        .find({ car: id })
        .sort({ date: -1 })
        .lean()
        .exec(),
      this.reservationModel
        .find({ car: id })
        .populate({ path: 'clients', model: 'Client', select: 'firstName lastName cin phone' })
        .sort({ startDate: -1 })
        .lean()
        .exec(),
    ]);

    if (!car) throw new NotFoundException(`Car with ID ${id} not found`);

    const carData = car as any;
    carData.contrats = contrats || [];
    carData.visites = visites && visites.length > 0 ? visites : (carData.visites || []);
    carData.depenses = depenses && depenses.length > 0 ? depenses : (carData.depenses || []);
    carData.reservations = reservations && reservations.length > 0 ? reservations : (carData.reservations || []);
    
    // Deduplicate documents: keep the latest valid entry per type
    if (carData.documents && Array.isArray(carData.documents) && carData.documents.length > 0) {
      const docMap = new Map<string, any>();
      for (const d of carData.documents) {
        if (d?.type && d?.url) {
          docMap.set(d.type, d);
        }
      }
      const uniqueDocs = Array.from(docMap.values());
      if (uniqueDocs.length < carData.documents.length) {
        // Automatically clean up accumulated duplicate documents in DB
        await this.carModel.findByIdAndUpdate(id, { documents: uniqueDocs }).exec();
        carData.documents = uniqueDocs;
      }
    } else {
      carData.documents = carData.documents || [];
    }

    return carData;
  }

  async update(id: string, updateCarDto: any): Promise<CarDocument> {
    if (updateCarDto.documents && Array.isArray(updateCarDto.documents)) {
      const docMap = new Map<string, any>();
      for (const d of updateCarDto.documents) {
        if (d?.type && d?.url) {
          docMap.set(d.type, d);
        }
      }
      updateCarDto.documents = Array.from(docMap.values());
    }

    const car = (await this.carModel
      .findByIdAndUpdate(id, updateCarDto, { new: true })
      .exec()) as CarDocument;
    if (!car) throw new NotFoundException(`Car with ID ${id} not found`);
    this.eventsGateway.broadcastDataChange('car:change', {
      action: 'updated',
      carId: car._id,
    });
    return car;
  }

  async addDocument(
    id: string,
    document: Partial<Car['documents'][number]>,
  ): Promise<any> {
    const existing = await this.carModel.findById(id);
    if (!existing) throw new NotFoundException(`Car with ID ${id} not found`);

    let docs = existing.documents || [];
    if (document.type) {
      docs = docs.filter((d: any) => d.type !== document.type);
    }
    docs.push(document as any);

    existing.documents = docs;
    await existing.save();

    this.eventsGateway.broadcastDataChange('car:change', {
      action: 'updated',
      carId: existing._id,
    });
    return existing.documents[existing.documents.length - 1];
  }

  async removeDocument(id: string, documentId: string): Promise<any> {
    const car = await this.carModel
      .findByIdAndUpdate(
        id,
        { $pull: { documents: { _id: documentId } } },
        { new: true },
      )
      .exec();
    if (!car) throw new NotFoundException(`Car with ID ${id} not found`);
    this.eventsGateway.broadcastDataChange('car:change', {
      action: 'updated',
      carId: car._id,
    });
    return { deleted: true };
  }

  async remove(id: string): Promise<any> {
    const result = await this.carModel
      .findByIdAndUpdate(
        id,
        { disabled: true, isAvailable: false },
        { new: true },
      )
      .exec();
    this.eventsGateway.broadcastDataChange('car:change', {
      action: 'removed',
      carId: id,
    });
    return result;
  }
}

