import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Depense, DepenseDocument } from './schemas/depense.schema';
import { Car, CarDocument } from '../car/schemas/car.schema';
import { JourneeService } from '../journee/journee.service';
import { LogService } from '../log/log.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class DepenseService {
  constructor(
    @InjectModel(Depense.name)
    private readonly depenseModel: Model<DepenseDocument>,
    @InjectModel(Car.name) private readonly carModel: Model<CarDocument>,
    private readonly journeeService: JourneeService,
    private readonly logService: LogService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async create(createDepenseDto: any, actor?: any): Promise<DepenseDocument> {
    return this.createOne(createDepenseDto, actor);
  }

  async createMany(
    createDepenseDtos: any[],
    actor?: any,
  ): Promise<DepenseDocument[]> {
    const savedDepenses: DepenseDocument[] = [];
    for (const dto of createDepenseDtos) {
      savedDepenses.push(await this.createOne(dto, actor));
    }
    return savedDepenses;
  }

  private async createOne(
    createDepenseDto: any,
    actor?: any,
  ): Promise<DepenseDocument> {
    let savedDepense: DepenseDocument;

    if (createDepenseDto.car) {
      const car = await this.carModel.findById(createDepenseDto.car).exec();
      if (!car) throw new NotFoundException('Car not found');

      const createdDepense = new this.depenseModel(
        createDepenseDto,
      ) as DepenseDocument;
      savedDepense = await createdDepense.save();

      await this.carModel
        .findByIdAndUpdate(car._id, { $push: { depenses: savedDepense._id } })
        .exec();
    } else {
      const createdDepense = new this.depenseModel(
        createDepenseDto,
      ) as DepenseDocument;
      savedDepense = await createdDepense.save();
    }

    // Log to Journee
    await this.journeeService.addEntry(
      'DEPENSE',
      savedDepense.description || 'Dépense',
      -Math.abs(savedDepense.amount || 0),
      savedDepense._id.toString(),
    );

    await this.logService.add({
      action: 'DEPENSE_CREATED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role,
      detail: `Dépense enregistrée (${savedDepense.category}) — ${savedDepense.amount} TND${savedDepense.description ? ` : ${savedDepense.description}` : ''}`,
    });

    this.eventsGateway.broadcastDataChange('depense:change', { action: 'created' });

    return savedDepense;
  }

  async findAll(carId?: string): Promise<DepenseDocument[]> {
    const query: any = carId ? { car: carId } : {};
    return this.depenseModel
      .find(query)
      .select('_id date amount category description car createdAt')
      .populate('car', 'brand model matricule')
      .sort({ date: -1 })
      .lean()
      .exec() as any;
  }

  async findOne(id: string): Promise<DepenseDocument> {
    const depense = await this.depenseModel.findById(id).populate('car').exec();
    if (!depense)
      throw new NotFoundException(`Expense with ID ${id} not found`);
    return depense;
  }

  async update(id: string, updateDepenseDto: any): Promise<DepenseDocument> {
    const existingDepense = await this.depenseModel.findById(id).exec();
    if (!existingDepense)
      throw new NotFoundException(`Expense with ID ${id} not found`);

    const oldCarId = existingDepense.car?.toString();
    const newCarId = updateDepenseDto.car;

    // Perform the update
    const updatedDepense = await this.depenseModel
      .findByIdAndUpdate(id, updateDepenseDto, { new: true })
      .exec();

    // If the car reference changed, update the cars' depenses arrays
    if (oldCarId !== newCarId) {
      if (oldCarId) {
        await this.carModel
          .findByIdAndUpdate(oldCarId, { $pull: { depenses: id } })
          .exec();
      }
      if (newCarId) {
        await this.carModel
          .findByIdAndUpdate(newCarId, { $push: { depenses: id } })
          .exec();
      }
    }

    if (!updatedDepense)
      throw new NotFoundException(`Expense with ID ${id} not found`);

    this.eventsGateway.broadcastDataChange('depense:change', { action: 'updated', id });
    return updatedDepense;
  }

  async remove(id: string, actor?: any): Promise<void> {
    const depense = await this.depenseModel.findById(id).exec();
    if (depense && depense.car) {
      await this.carModel
        .findByIdAndUpdate(depense.car, { $pull: { depenses: id } })
        .exec();
    }
    await this.depenseModel.findByIdAndDelete(id).exec();

    if (depense) {
      await this.logService.add({
        action: 'DEPENSE_DELETED',
        actorId: actor?.id,
        actorName: actor?.name,
        role: actor?.role,
        detail: `Suppression d'une dépense (${depense.category}) — ${depense.amount} TND`,
      });
      this.eventsGateway.broadcastDataChange('depense:change', { action: 'removed', id });
    }
  }
}
