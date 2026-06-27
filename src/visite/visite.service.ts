import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Visite, VisiteDocument } from './schemas/visite.schema';
import { Car, CarDocument } from '../car/schemas/car.schema';
import { Depense, DepenseDocument } from '../depense/schemas/depense.schema';

@Injectable()
export class VisiteService {
  constructor(
    @InjectModel(Visite.name) private readonly visiteModel: Model<VisiteDocument>,
    @InjectModel(Car.name) private readonly carModel: Model<CarDocument>,
    @InjectModel(Depense.name) private readonly depenseModel: Model<DepenseDocument>,
  ) {}

  async create(createVisiteDto: any): Promise<VisiteDocument> {
    const car = await this.carModel.findById(createVisiteDto.car).exec();
    if (!car) throw new NotFoundException('Car not found');

    const createdVisite = new this.visiteModel(createVisiteDto) as VisiteDocument;
    
    // Auto-calculate next visit date if not provided (6 months later)
    if (!createdVisite.nextVisitDate) {
      const nextDate = new Date(createdVisite.date);
      nextDate.setMonth(nextDate.getMonth() + 6);
      createdVisite.nextVisitDate = nextDate;
    }

    const savedVisite = await createdVisite.save();

    // 2. Create corresponding Depense record
    const createdDepense = new this.depenseModel({
      car: car._id,
      date: savedVisite.date,
      amount: savedVisite.cost,
      category: 'VISITE',
      description: `Visite Technique auto | KM: ${savedVisite.mileageAtVisit} | Résultat: ${savedVisite.result}`
    });
    const savedDepense = await createdDepense.save();

    // 3. Update Car record: link the visit, depense and update the nextTechnicalVisitDate
    await this.carModel.findByIdAndUpdate(car._id, { 
      $push: { 
        visites: savedVisite._id,
        depenses: savedDepense._id
      },
      nextTechnicalVisitDate: savedVisite.nextVisitDate
    }).exec();
    return savedVisite;
  }

  async findAll(carId?: string): Promise<Visite[]> {
    const query: any = carId ? { car: carId } : {};
    return this.visiteModel.find(query).populate('car').exec();
  }

  async findOne(id: string): Promise<Visite> {
    const visite = await this.visiteModel.findById(id).populate('car').exec();
    if (!visite) throw new NotFoundException(`Visite with ID ${id} not found`);
    return visite;
  }

  async remove(id: string): Promise<any> {
    const visite = await this.visiteModel.findById(id).exec();
    if (!visite) throw new NotFoundException(`Visite with ID ${id} not found`);

    // Remove related depense
    await this.depenseModel.findOneAndDelete({
      car: visite.car,
      date: visite.date,
      amount: visite.cost,
      category: 'VISITE'
    }).exec();

    await this.carModel.findByIdAndUpdate(visite.car, { 
      $pull: { visites: id } 
    }).exec();

    return await this.visiteModel.findByIdAndDelete(id).exec();
  }

  async update(id: string, updateVisiteDto: any): Promise<VisiteDocument> {
    const visite = await this.visiteModel.findByIdAndUpdate(id, updateVisiteDto, { new: true }).exec();
    if (!visite) throw new NotFoundException(`Visite with ID ${id} not found`);

    // Sync with depense if needed (simplified)
    await this.depenseModel.findOneAndUpdate(
      { car: visite.car, date: visite.date, category: 'VISITE' },
      { amount: visite.cost, description: `Visite Technique auto | KM: ${visite.mileageAtVisit} | Résultat: ${visite.result}` }
    ).exec();

    return visite;
  }
}
