import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Car, CarDocument } from './schemas/car.schema';
import { BookingConflictService } from '../shared/booking-conflict.service';

@Injectable()
export class CarService {
  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    private readonly bookingConflictService: BookingConflictService
  ) {}

  async create(createCarDto: any): Promise<CarDocument> {
    const createdCar = new this.carModel(createCarDto) as CarDocument;
    return await createdCar.save();
  }

  async findAvailable(startDate: Date, endDate: Date): Promise<CarDocument[]> {
    const allCars = await this.carModel.find({ disabled: false }).exec();
    
    const availableCars = [];
    for (const car of allCars) {
      const conflictResult = await this.bookingConflictService.findConflicts(
        (car as any)._id.toString(),
        startDate,
        endDate
      );
      
      if (!conflictResult.hasConflicts) {
        availableCars.push(car);
      }
    }
    
    return availableCars;
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
    if (filters.isAvailable !== undefined) query['isAvailable'] = filters.isAvailable;

    let cars = await this.carModel.find(query).exec();

    if (filters.isAvailable) {
      const now = new Date();
      const startOfDay = new Date(now.setHours(0, 0, 0, 0));
      const endOfDay = new Date(now.setHours(23, 59, 59, 999));
      
      const filtered = [];
      for (const car of cars) {
        const conflicts = await this.bookingConflictService.findConflicts(
          (car as any)._id.toString(),
          startOfDay,
          endOfDay
        );
        if (!conflicts.hasConflicts) {
          filtered.push(car);
        }
      }
      cars = filtered;
    }

    return cars;
  }

  async findOne(id: string): Promise<CarDocument> {
    const car = await this.carModel.findById(id)
      .populate('reservations')
      .populate('visites')
      .populate('vidanges')
      .populate('depenses')
      .exec() as CarDocument;
    if (!car) throw new NotFoundException(`Car with ID ${id} not found`);
    return car;
  }

  async update(id: string, updateCarDto: any): Promise<CarDocument> {
    const car = await this.carModel.findByIdAndUpdate(id, updateCarDto, { new: true }).exec() as CarDocument;
    if (!car) throw new NotFoundException(`Car with ID ${id} not found`);
    return car;
  }

  async remove(id: string): Promise<any> {
    return await this.carModel.findByIdAndUpdate(id, { disabled: true, isAvailable: false }, { new: true }).exec();
  }
}
