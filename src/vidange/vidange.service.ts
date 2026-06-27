import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Vidange, VidangeDocument } from './schemas/vidange.schema';
import { Car, CarDocument } from '../car/schemas/car.schema';
import { Depense, DepenseDocument } from '../depense/schemas/depense.schema';

@Injectable()
export class VidangeService {
  constructor(
    @InjectModel(Vidange.name) private readonly vidangeModel: Model<VidangeDocument>,
    @InjectModel(Car.name) private readonly carModel: Model<CarDocument>,
    @InjectModel(Depense.name) private readonly depenseModel: Model<DepenseDocument>,
  ) {}

  async create(createVidangeDto: any): Promise<VidangeDocument> {
    const car = await this.carModel.findById(createVidangeDto.car).exec();
    if (!car) throw new NotFoundException('Car not found');

    const createdVidange = new this.vidangeModel(createVidangeDto) as VidangeDocument;
    const savedVidange = await createdVidange.save();

    // 2. Create corresponding Depense record
    const createdDepense = new this.depenseModel({
      car: car._id,
      date: savedVidange.date,
      amount: savedVidange.amount,
      category: 'VIDANGE',
      description: `Vidange auto: ${savedVidange.oilType} | KM: ${savedVidange.mileageAtChange}`
    });
    const savedDepense = await createdDepense.save();

    // 3. Auto-update car mileage and calculate next oil change (+10,000km)
    const nextMileage = savedVidange.mileageAtChange + 10000;

    await this.carModel.findByIdAndUpdate(car._id, { 
      $push: { 
        vidanges: savedVidange._id,
        depenses: savedDepense._id
      },
      mileage: savedVidange.mileageAtChange,
      nextOilChangeMileage: nextMileage
    }).exec();

    return savedVidange;
  }

  async findAll(carId?: string): Promise<VidangeDocument[]> {
    const query: any = carId ? { car: carId } : {};
    return this.vidangeModel.find(query).populate('car').exec();
  }

  async findOne(id: string): Promise<VidangeDocument> {
    const vidange = await this.vidangeModel.findById(id).populate('car').exec();
    if (!vidange) throw new NotFoundException(`Vidange with ID ${id} not found`);
    return vidange;
  }

  async remove(id: string): Promise<void> {
    const vidange = await this.vidangeModel.findById(id).exec();
    if (vidange) {
      // Remove related depense (matching car, date, and amount)
      await this.depenseModel.findOneAndDelete({
        car: vidange.car,
        date: vidange.date,
        amount: vidange.amount,
        category: 'VIDANGE'
      }).exec();
      
      await this.carModel.findByIdAndUpdate(vidange.car, {
        $pull: { vidanges: id }
      }).exec();

      await this.vidangeModel.findByIdAndDelete(id).exec();
    }
  }
}
