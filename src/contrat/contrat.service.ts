import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contrat, ContratDocument } from './schemas/contrat.schema';
import { Car, CarDocument } from '../car/schemas/car.schema';
import { Client, ClientDocument } from '../client/schemas/client.schema';
import {
  Reservation,
  ReservationDocument,
} from '../reservation/schemas/reservation.schema';
import { Depense, DepenseDocument } from '../depense/schemas/depense.schema';

import { JourneeService } from '../journee/journee.service';
import { BookingConflictService } from '../shared/booking-conflict.service';
import { SettingService } from '../setting/setting.service';
import { LogService } from '../log/log.service';
import { EventsGateway } from '../events/events.gateway';
import { LotContratService } from '../lot-contrat/lot-contrat.service';

@Injectable()
export class ContratService implements OnModuleInit {
  constructor(
    @InjectModel(Contrat.name) private contratModel: Model<ContratDocument>,
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    @InjectModel(Reservation.name)
    private reservationModel: Model<ReservationDocument>,
    @InjectModel(Depense.name) private depenseModel: Model<DepenseDocument>,
    private journeeService: JourneeService,
    private bookingConflictService: BookingConflictService,
    private settingService: SettingService,
    private logService: LogService,
    private eventsGateway: EventsGateway,
    private lotContratService: LotContratService,
  ) {}

  private lastStatusCheck = 0;

  async onModuleInit() {
    try {
      await this.contratModel
        .updateMany(
          { carburantLevel: { $exists: false } },
          { $set: { carburantLevel: 50 } },
        )
        .exec();
      await this.contratModel
        .updateMany(
          { lieuDepart: { $exists: false } },
          { $set: { lieuDepart: 'Djerba' } },
        )
        .exec();
      await this.contratModel
        .updateMany(
          { lieuRetour: { $exists: false } },
          { $set: { lieuRetour: 'Djerba' } },
        )
        .exec();

      // Clean up any contracts previously linked to lots that are out of interval
      await this.lotContratService.cleanupOutOfRangeContrats();

      // Sync relation from carnet to contrat for existing records that are strictly in interval
      const contractsWithLot = await this.contratModel
        .find({ lot: { $exists: true, $ne: null } })
        .populate('lot')
        .select('_id lot reference')
        .exec();
      for (const c of contractsWithLot) {
        if (c.lot) {
          const lot = c.lot as any;
          const refNum = this.lotContratService.extractRefNumber(c.reference);
          if (refNum !== null && refNum >= lot.startNumber && refNum <= lot.endNumber) {
            await this.lotContratService.addContratToLot(
              lot._id.toString(),
              c._id.toString(),
              undefined,
              false,
            );
          } else {
            // Out of range: unlink!
            await this.contratModel.findByIdAndUpdate(c._id, { $unset: { lot: 1 } });
            await this.lotContratService.removeContratFromLot(
              lot._id.toString(),
              c._id.toString(),
            );
          }
        }
      }

      // Also auto-link existing contracts without lot ONLY if their reference is strictly in an active carnet's interval
      const contractsWithoutLot = await this.contratModel
        .find({ $or: [{ lot: { $exists: false } }, { lot: null }] })
        .populate('car', 'agence')
        .select('_id reference agency car')
        .exec();
      for (const c of contractsWithoutLot) {
        const refNum = this.lotContratService.extractRefNumber(c.reference);
        if (refNum === null) continue; // Skip non-carnet references like CTR-...

        const agId =
          (c.car as any)?.agence?._id?.toString() ||
          (c.car as any)?.agence?.toString();
        const agName = (c as any).agency;
        const matchedLot = await this.lotContratService.findActiveLotForContract({
          agencyId: agId,
          agencyName: agName,
          reference: c.reference,
        });
        if (matchedLot) {
          c.lot = matchedLot._id;
          await c.save();
          await this.lotContratService.addContratToLot(
            matchedLot._id.toString(),
            c._id.toString(),
            undefined,
            false,
          );
        }
      }
    } catch (err) {
      console.error('Error auto-migrating contrat fields on module init:', err);
    }
  }

  private generateReference(): string {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(1000 + Math.random() * 9000);
    return `CTR-${today}-${random}`;
  }

  async create(
    createContratDto: any,
    actor?: any,
  ): Promise<ContratDocument> {
    const car = await this.carModel.findById(createContratDto.car).exec();
    if (!car) throw new NotFoundException('Car not found');

    if (createContratDto.clients && createContratDto.clients.length > 2) {
      throw new BadRequestException(
        'A contract can have a maximum of 2 clients.',
      );
    }

    const start = new Date(createContratDto.startDate);
    const end = new Date(createContratDto.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const settings = await this.settingService.getSettings();
    const dailyRate =
      createContratDto.carDailyRate !== undefined
        ? createContratDto.carDailyRate
        : car.dailyRate || 0;
    createContratDto.carDailyRate = dailyRate;

    const baseAmount = diffDays * dailyRate;
    let taxAmount = 0;
    let tvaAmount = 0;

    // Use DTO values if provided (manual override), otherwise use settings
    const currentTaxValue =
      createContratDto.contractTaxValue !== undefined
        ? createContratDto.contractTaxValue
        : settings.contractTaxValue;

    const currentTvaValue =
      createContratDto.tvaValue !== undefined
        ? createContratDto.tvaValue
        : settings.tvaValue;

    // The client pays only Base + TVA (on Base only)
    if (settings.tvaEnabled) {
      tvaAmount = baseAmount * (currentTvaValue / 100);
    }

    createContratDto.totalAmount =
      Math.round((baseAmount + tvaAmount) * 100) / 100;

    // Tax is now an internal expense (Depense), client doesn't pay it
    if (settings.contractTaxEnabled) {
      taxAmount = currentTaxValue || 0;
    }

    createContratDto.contractTaxValue = taxAmount;
    createContratDto.tvaValue = currentTvaValue;
    createContratDto.createdBy = actor?.id;

    if (!createContratDto.reference) {
      createContratDto.reference = this.generateReference();
    }

    if (!createContratDto.startMileage) {
      createContratDto.startMileage = car.mileage || 0;
    }

    // Conflict Check (Overlapping confirmed reservations OR other contracts)
    const conflicts = await this.bookingConflictService.findConflicts(
      createContratDto.car,
      start,
      end,
      createContratDto.reservation, // Exclude the reservation being converted
    );

    if (conflicts.hasConflicts && createContratDto.force !== true) {
      throw new ConflictException({
        message: 'CAR_RESERVED_CONFLICT',
        conflicts: {
          reservations: conflicts.reservations,
          contracts: conflicts.contracts,
        },
      });
    }

    if (createContratDto.force && conflicts.reservations.length > 0) {
      // Return conflicting reservations to planning (pending)
      await this.reservationModel
        .updateMany(
          { _id: { $in: conflicts.reservations.map((c) => c._id) } },
          { status: 'pending' },
        )
        .exec();
    }
    // Decide status and car availability based on start date
    const now = new Date();
    const isFuture = start > now;
    createContratDto.status = isFuture ? 'soon' : 'active';

    const createdContrat = new this.contratModel(
      createContratDto,
    ) as ContratDocument;

    // Link to reservation if provided
    if (createContratDto.reservation) {
      createdContrat.reservation = createContratDto.reservation;
    }

    // Link to Lot and increment lot current number (ONLY if contract reference is a code number within carnet interval)
    const refNum = this.lotContratService.extractRefNumber(createContratDto.reference);
    const lotIdCandidate = createContratDto.lotId;
    delete createContratDto.lot;
    delete createContratDto.lotId;

    let targetLot: any = null;

    if (refNum !== null) {
      const agencyId =
        createContratDto.agence ||
        createContratDto.agencyId ||
        (car as any)?.agence?.toString();
      const agencyName =
        createContratDto.agency || (car as any)?.agence?.name;

      targetLot = await this.lotContratService.findActiveLotForContract({
        lotId: lotIdCandidate,
        agencyId,
        agencyName,
        reference: createContratDto.reference,
      });
    }

    if (targetLot) {
      createdContrat.lot = targetLot._id;
    }

    const savedContrat = await createdContrat.save();

    // Link carnet to contrat (relation oriented from carnet to contrat)
    if (targetLot && refNum !== null) {
      await this.lotContratService.addContratToLot(
        targetLot._id.toString(),
        savedContrat._id.toString(),
        refNum,
        true,
      );
    }

    // Auto-update car's dailyRate to match the contract's rate
    if (dailyRate > 0 && dailyRate !== car.dailyRate) {
      await this.carModel.findByIdAndUpdate(car._id, { dailyRate }).exec();
    }

    // Auto-update car's mileage with the contract's start mileage
    if (createContratDto.startMileage > (car.mileage || 0)) {
      await this.carModel
        .findByIdAndUpdate(car._id, { mileage: createContratDto.startMileage })
        .exec();
    }

    // Create a Depense (Expense) for the contract fee if it exists
    if (taxAmount > 0) {
      await new this.depenseModel({
        car: car._id,
        date: new Date(),
        amount: taxAmount,
        category: 'Frais sur contrat',
        description: `Taxe/Frais pour le contrat ${savedContrat.reference}`,
      }).save();
    }

    // If linked to reservation, update reservation status and link
    if (createContratDto.reservation) {
      await this.reservationModel
        .findByIdAndUpdate(createContratDto.reservation, {
          status: 'converted',
          contrat: savedContrat._id,
        })
        .exec();
    }

    // Log to Journee
    await this.journeeService.addEntry(
      'CONTRAT_OUVERT',
      `Ouverture du contrat ${savedContrat.reference} (${car.brand} ${car.model})`,
      savedContrat.totalAmount || 0,
      savedContrat.reference,
    );

    await this.logService.add({
      action: 'CONTRAT_CREATED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role,
      detail: `Création du contrat ${savedContrat.reference} (${car.brand} ${car.model}) — montant ${savedContrat.totalAmount} TND`,
    });

    // Mark car as unavailable ONLY if the contract is active today
    if (savedContrat.status === 'active') {
      await this.carModel
        .findByIdAndUpdate(car._id, { isAvailable: false })
        .exec();
    }

    // Increment totalRents for all clients in this contract
    if (createContratDto.clients && createContratDto.clients.length > 0) {
      await this.clientModel
        .updateMany(
          { _id: { $in: createContratDto.clients } },
          { $inc: { totalRents: 1 } },
        )
        .exec();
    }

    this.eventsGateway.broadcastDataChange('contract:change', {
      action: 'created',
      reference: savedContrat.reference,
    });

    return savedContrat;
  }

  private async runStatusCheck(): Promise<void> {
    const now = new Date();
    try {
      // Auto-activate 'soon' contracts whose start time has passed
      const toActivate = await this.contratModel
        .find({
          status: 'soon',
          isDeleted: { $ne: true },
          startDate: { $lte: now },
        }, { _id: 1, car: 1 })
        .lean()
        .exec();

      if (toActivate.length > 0) {
        const activateIds = toActivate.map(c => c._id);
        const activateCarIds = toActivate.map(c => c.car).filter(Boolean);
        await Promise.all([
          this.contratModel.updateMany({ _id: { $in: activateIds } }, { $set: { status: 'active' } }).exec(),
          this.carModel.updateMany({ _id: { $in: activateCarIds } }, { $set: { isAvailable: false } }).exec(),
        ]);
      }

      // Auto-terminate 'active' contracts whose end date has passed
      const toTerminate = await this.contratModel
        .find({
          status: 'active',
          isDeleted: { $ne: true },
          endDate: { $lte: now },
        }, { _id: 1, car: 1 })
        .lean()
        .exec();

      if (toTerminate.length > 0) {
        const terminateIds = toTerminate.map(c => c._id);
        const terminateCarIds = toTerminate.map(c => c.car).filter(Boolean);
        await Promise.all([
          this.contratModel.updateMany({ _id: { $in: terminateIds } }, { $set: { status: 'terminé' } }).exec(),
          this.carModel.updateMany({ _id: { $in: terminateCarIds } }, { $set: { isAvailable: true } }).exec(),
        ]);
      }

      // Reconcile: Ensure all cars with an active non-deleted contract are marked as rented (isAvailable: false)
      const activeContracts = await this.contratModel
        .find({
          status: 'active',
          isDeleted: { $ne: true },
        }, { car: 1 })
        .lean()
        .exec();

      if (activeContracts.length > 0) {
        const activeCarIds = activeContracts.map(c => c.car).filter(Boolean);
        await this.carModel.updateMany(
          { _id: { $in: activeCarIds }, isAvailable: true },
          { $set: { isAvailable: false } }
        ).exec();
      }
    } catch (err) {
      console.error('Error during contract status auto-check:', err);
    }
  }

  async findAll(filters: any = {}): Promise<ContratDocument[]> {
    // Non-blocking throttled auto-status check (runs in background without delaying read response)
    if (Date.now() - this.lastStatusCheck > 60000) {
      this.lastStatusCheck = Date.now();
      setImmediate(() => {
        this.runStatusCheck().catch(err =>
          console.error('Error in background status check:', err),
        );
      });
    }

    const query: any = { isDeleted: { $ne: true } };
    if (filters.status) query['status'] = filters.status;
    if (filters.carId) query['car'] = filters.carId;
    if (filters.reference) query['reference'] = filters.reference;
    if (filters.lotId) query['lot'] = filters.lotId;
    if (filters.clientId) {
      query['$or'] = [
        { clients: filters.clientId },
        { client: filters.clientId },
      ];
    }

    // Fast lightweight summary projection for Compta / conflict checkers
    if (filters.summary === 'true') {
      return this.contratModel
        .find(query)
        .select('reference status startDate endDate totalAmount car clients client isPaid paymentMethod createdAt')
        .populate({ path: 'car', select: 'brand model matricule' })
        .populate({ path: 'clients', select: 'firstName lastName cin phone' })
        .sort({ createdAt: -1 })
        .lean()
        .exec() as any;
    }

    return this.contratModel
      .find(query)
      .select('reference car clients client startDate endDate totalAmount depositAmount carDailyRate status createdBy notes startMileage returnMileage carStateAtReturn closureType closureNotes isPaid paymentMethod chequeNumber bankName reservation contractTaxValue tvaValue agency carburantLevel lieuDepart lieuRetour lot createdAt')
      .populate({
        path: 'car',
        select: 'brand model matricule color agence',
        populate: { path: 'agence', model: 'Agence', select: 'name' },
      })
      .populate({ path: 'clients', model: 'Client', select: 'firstName lastName cin phone drivingLicense' })
      .populate('createdBy', 'firstName lastName')
      .populate({ path: 'lot', model: 'LotContrat', select: 'name startNumber endNumber status' })
      .sort({ createdAt: -1 })
      .lean()
      .exec() as any;
  }

  async findOne(id: string, lean = false): Promise<any> {
    const query = this.contratModel
      .findById(id)
      .populate({
        path: 'car',
        populate: { path: 'agence', model: 'Agence', select: 'name' },
      })
      .populate({ path: 'clients', model: 'Client' })
      .populate('createdBy', 'firstName lastName')
      .populate('lot');

    if (lean) {
      query.lean();
    }

    const contrat = await query.exec();
    if (!contrat)
      throw new NotFoundException(`Contract with ID ${id} not found`);

    // Safety check for client population
    if (!contrat.clients) {
      (contrat as any).clients = [];
    }

    return contrat;
  }

  async close(
    id: string,
    closureData: any,
    actor?: any,
  ): Promise<ContratDocument> {
    const contrat = await this.findOne(id);
    if (contrat.status !== 'active' && contrat.status !== 'terminé') {
      throw new BadRequestException(
        'Seuls les contrats actifs ou terminés peuvent être clôturés',
      );
    }

    // Determine status based on closureType
    contrat.status =
      closureData.closureType === 'terminé' ? 'terminé' : 'clôturé';
    contrat.returnMileage = closureData.returnMileage;
    contrat.carStateAtReturn = closureData.carStateAtReturn;
    contrat.closureType = closureData.closureType;
    contrat.closureNotes = closureData.closureNotes;
    contrat.isPaid = closureData.isPaid;

    await contrat.save();

    // Restore car availability and update mileage
    const carId = (contrat.car as any)?._id || contrat.car;
    const carUpdate: any = {
      isAvailable: closureData.carStateAtReturn === 'disponible',
      mileage: closureData.returnMileage,
    };
    await this.carModel.findByIdAndUpdate(carId, carUpdate).exec();



    void this.logService.add({
      action: 'CONTRAT_CLOSED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role,
      detail: `Clôture du contrat ${contrat.reference} — statut: ${contrat.status}, kilométrage retour: ${closureData.returnMileage} km`,
    }).catch(err => console.error('Failed to log contract closure:', err));

    this.eventsGateway.broadcastDataChange('contract:change', {
      action: 'closed',
      reference: contrat.reference,
    });

    return contrat;
  }

  async cancel(id: string, actor?: any): Promise<ContratDocument> {
    const contrat = await this.findOne(id);
    if (contrat.status !== 'active' && contrat.status !== 'soon') {
      throw new BadRequestException(
        'Only active or upcoming contracts can be cancelled',
      );
    }

    contrat.status = 'cancelled';
    await (contrat as any).save();

    // Restore car availability
    await this.carModel
      .findByIdAndUpdate(contrat.car, { isAvailable: true })
      .exec();

    await this.logService.add({
      action: 'CONTRAT_CANCELLED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role,
      detail: `Annulation du contrat ${contrat.reference}`,
    });

    this.eventsGateway.broadcastDataChange('contract:change', {
      action: 'cancelled',
      reference: contrat.reference,
    });

    return contrat;
  }

  async update(
    id: string,
    updateContratDto: any,
    actor?: any,
  ): Promise<ContratDocument> {
    const contrat = await this.contratModel.findById(id).exec();
    if (!contrat)
      throw new NotFoundException(`Contract with ID ${id} not found`);

    const startDate = updateContratDto.startDate
      ? new Date(updateContratDto.startDate)
      : contrat.startDate;
    const endDate = updateContratDto.endDate
      ? new Date(updateContratDto.endDate)
      : contrat.endDate;
    const carId =
      updateContratDto.car || (contrat.car ? contrat.car.toString() : null);

    if (!carId) throw new BadRequestException('Contract has no car assigned.');

    const car = await this.carModel.findById(carId).exec();
    if (!car) throw new NotFoundException('Car not found');

    if (updateContratDto.clients && updateContratDto.clients.length > 2) {
      throw new BadRequestException(
        'A contract can have a maximum of 2 clients.',
      );
    }

    // Check conflict if car or dates changed (60s tolerance to handle timezone/rounding)
    const TOLERANCE_MS = 60 * 1000;
    const datesChanged =
      (updateContratDto.startDate &&
        Math.abs(
          new Date(updateContratDto.startDate).getTime() -
            new Date(contrat.startDate).getTime(),
        ) > TOLERANCE_MS) ||
      (updateContratDto.endDate &&
        Math.abs(
          new Date(updateContratDto.endDate).getTime() -
            new Date(contrat.endDate).getTime(),
        ) > TOLERANCE_MS);
    const carChanged =
      updateContratDto.car &&
      updateContratDto.car.toString() !== contrat.car.toString();

    if (datesChanged || carChanged) {
      const conflicts = await this.bookingConflictService.findConflicts(
        carId,
        startDate,
        endDate,
        undefined,
        contrat._id.toString(),
      );

      if (conflicts.hasConflicts && updateContratDto.force !== true) {
        throw new ConflictException({
          message: 'CAR_RESERVED_CONFLICT',
          conflicts: {
            reservations: conflicts.reservations,
            contracts: conflicts.contracts,
          },
        });
      }

      if (updateContratDto.force && conflicts.reservations.length > 0) {
        await this.reservationModel
          .updateMany(
            { _id: { $in: conflicts.reservations.map((c) => c._id) } },
            { status: 'pending' },
          )
          .exec();
      }
    }

    // Recalculate amount if dates or car or rates changed, and if not manually specified in the update DTO
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const settings = await this.settingService.getSettings();
    const dailyRate =
      updateContratDto.carDailyRate !== undefined
        ? updateContratDto.carDailyRate
        : contrat.carDailyRate !== undefined
          ? contrat.carDailyRate
          : car.dailyRate || 0;

    const baseAmount = diffDays * dailyRate;

    const currentTaxValue =
      updateContratDto.contractTaxValue !== undefined
        ? updateContratDto.contractTaxValue
        : contrat.contractTaxValue;

    const currentTvaValue =
      updateContratDto.tvaValue !== undefined
        ? updateContratDto.tvaValue
        : contrat.tvaValue;

    let tvaAmount = 0;
    if (settings.tvaEnabled) {
      tvaAmount = baseAmount * (currentTvaValue / 100);
    }

    const totalAmount =
      updateContratDto.totalAmount !== undefined
        ? updateContratDto.totalAmount
        : Math.round((baseAmount + tvaAmount) * 100) / 100;

    // Handle car availability if car changed or status changed
    const oldCarId = contrat.car ? contrat.car.toString() : null;
    const oldStatus = contrat.status;
    const newStatus = updateContratDto.status || contrat.status;

    // Handle client count adjustments if clients changed
    if (updateContratDto.clients) {
      const oldClients = contrat.clients
        ? contrat.clients.map((c) => c.toString())
        : [];
      const newClients = updateContratDto.clients.map((c: any) => c.toString());

      const addedClients = newClients.filter(
        (c: any) => !oldClients.includes(c),
      );
      const removedClients = oldClients.filter(
        (c: any) => !newClients.includes(c),
      );

      if (addedClients.length > 0) {
        await this.clientModel
          .updateMany(
            { _id: { $in: addedClients } },
            { $inc: { totalRents: 1 } },
          )
          .exec();
      }
      if (removedClients.length > 0) {
        await this.clientModel
          .updateMany(
            { _id: { $in: removedClients } },
            { $inc: { totalRents: -1 } },
          )
          .exec();
      }
    }

    // Apply all updates directly to the document
    contrat.car = carId;
    contrat.startDate = startDate;
    contrat.endDate = endDate;
    contrat.carDailyRate = dailyRate;
    contrat.totalAmount = totalAmount;
    contrat.contractTaxValue = currentTaxValue;
    contrat.tvaValue = currentTvaValue;

    // Handle Reference / Contract Number update (e.g. Super Admin editing contract number)
    const rawRef =
      updateContratDto.reference !== undefined
        ? updateContratDto.reference
        : updateContratDto.contractNumber;

    if (rawRef !== undefined) {
      const newRef = String(rawRef).trim();
      if (newRef && newRef !== contrat.reference) {
        const existing = await this.contratModel
          .findOne({
            _id: { $ne: contrat._id },
            reference: newRef,
            isDeleted: { $ne: true },
          })
          .exec();
        if (existing) {
          throw new ConflictException(
            `Le numéro de contrat "${newRef}" est déjà utilisé par un autre contrat.`,
          );
        }
        contrat.reference = newRef;
      }
    }

    if (updateContratDto.clients !== undefined)
      contrat.clients = updateContratDto.clients;
    if (updateContratDto.depositAmount !== undefined)
      contrat.depositAmount = Number(updateContratDto.depositAmount);
    if (updateContratDto.status !== undefined)
      contrat.status = updateContratDto.status;
    if (updateContratDto.paymentMethod !== undefined)
      contrat.paymentMethod = updateContratDto.paymentMethod;
    if (updateContratDto.chequeNumber !== undefined)
      contrat.chequeNumber = updateContratDto.chequeNumber;
    if (updateContratDto.bankName !== undefined)
      contrat.bankName = updateContratDto.bankName;
    if (updateContratDto.notes !== undefined)
      contrat.notes = updateContratDto.notes;
    if (updateContratDto.agency !== undefined)
      contrat.agency = updateContratDto.agency;
    if (
      updateContratDto.carburantLevel !== undefined &&
      updateContratDto.carburantLevel !== null
    ) {
      contrat.carburantLevel = Number(updateContratDto.carburantLevel);
    }
    if (updateContratDto.lieuDepart !== undefined) {
      contrat.lieuDepart = String(updateContratDto.lieuDepart).trim();
    }
    if (updateContratDto.lieuRetour !== undefined) {
      contrat.lieuRetour = String(updateContratDto.lieuRetour).trim();
    }

    // Handle carnet/lot reassignment if specified
    if (updateContratDto.lot !== undefined || updateContratDto.lotId !== undefined) {
      const rawNewLotId = updateContratDto.lot || updateContratDto.lotId || null;
      const newLotId = rawNewLotId ? String(rawNewLotId).trim() : null;
      const oldLotId = contrat.lot ? contrat.lot.toString() : null;

      if (newLotId !== oldLotId) {
        if (oldLotId) {
          await this.lotContratService.removeContratFromLot(oldLotId, contrat._id.toString());
        }
        if (newLotId) {
          await this.lotContratService.addContratToLot(
            newLotId,
            contrat._id.toString(),
            undefined,
            false,
          );
          contrat.lot = new Types.ObjectId(newLotId);
        } else {
          contrat.lot = undefined;
        }
      }
    }

    await contrat.save();

    // Auto-update car's dailyRate if the contract rate changed
    if (dailyRate > 0 && dailyRate !== car.dailyRate) {
      await this.carModel.findByIdAndUpdate(carId, { dailyRate }).exec();
    }

    // Manage availability
    if (carChanged || oldStatus !== newStatus) {
      if (oldCarId && oldStatus === 'active') {
        await this.carModel
          .findByIdAndUpdate(oldCarId, { isAvailable: true })
          .exec();
      }
      if (newStatus === 'active') {
        await this.carModel
          .findByIdAndUpdate(carId, { isAvailable: false })
          .exec();
      }
    }

    await this.logService.add({
      action: 'CONTRAT_UPDATED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role,
      detail: `Modification du contrat ${contrat.reference} — statut: ${newStatus}`,
    });

    this.eventsGateway.broadcastDataChange('contract:change', {
      action: 'updated',
      reference: contrat.reference,
    });

    return this.findOne(id);
  }

  async findDeleted(): Promise<any[]> {
    return this.contratModel
      .find({ isDeleted: true })
      .populate({
        path: 'car',
        select: 'brand model matricule color agence',
        populate: { path: 'agence', model: 'Agence', select: 'name' },
      })
      .populate({ path: 'clients', model: 'Client', select: 'firstName lastName cin phone' })
      .populate('createdBy', 'firstName lastName')
      .populate('deletedBy', 'firstName lastName')
      .populate({ path: 'lot', model: 'LotContrat', select: 'name startNumber endNumber status' })
      .sort({ deletedAt: -1, updatedAt: -1 })
      .lean()
      .exec();
  }

  async remove(id: string, actor?: any): Promise<any> {
    const contrat = await this.contratModel.findById(id).exec();
    if (!contrat) throw new NotFoundException(`Contract with ID ${id} not found`);

    // If the contract is active or upcoming, make the car available again
    if (contrat.status === 'active' || contrat.status === 'soon') {
      await this.carModel
        .findByIdAndUpdate(contrat.car, { isAvailable: true })
        .exec();
    }

    contrat.isDeleted = true;
    (contrat as any).deletedAt = new Date();
    if (actor?.id) {
      (contrat as any).deletedBy = new Types.ObjectId(actor.id);
    }
    await contrat.save();

    await this.logService.add({
      action: 'CONTRAT_DELETED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role,
      detail: `Mise en corbeille du contrat ${contrat.reference}`,
    });

    this.eventsGateway.broadcastDataChange('contract:change', {
      action: 'removed',
      id,
    });
    return { success: true, id, message: 'Contrat déplacé dans la corbeille' };
  }

  async restore(id: string, actor?: any): Promise<ContratDocument> {
    const contrat = await this.contratModel.findById(id).exec();
    if (!contrat) throw new NotFoundException(`Contract with ID ${id} not found`);

    contrat.isDeleted = false;
    (contrat as any).deletedAt = undefined;
    (contrat as any).deletedBy = undefined;
    await contrat.save();

    // If contract status is active and current date falls in range, restore car reservation state
    const now = new Date();
    if (
      contrat.status === 'active' &&
      new Date(contrat.startDate) <= now &&
      new Date(contrat.endDate) >= now
    ) {
      await this.carModel
        .findByIdAndUpdate(contrat.car, { isAvailable: false })
        .exec();
    }

    await this.logService.add({
      action: 'CONTRAT_RESTORED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role,
      detail: `Restauration du contrat ${contrat.reference}`,
    });

    this.eventsGateway.broadcastDataChange('contract:change', {
      action: 'restored',
      id,
    });

    return contrat;
  }

  async permanentDelete(id: string, actor?: any): Promise<any> {
    const contrat = await this.contratModel.findById(id).exec();
    if (!contrat) throw new NotFoundException(`Contract with ID ${id} not found`);

    if (contrat.lot) {
      await this.lotContratService.removeContratFromLot(
        contrat.lot.toString(),
        contrat._id.toString(),
      );
    }

    const result = await this.contratModel.findByIdAndDelete(id).exec();

    await this.logService.add({
      action: 'CONTRAT_PERMANENT_DELETED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role,
      detail: `Suppression définitive du contrat ${contrat.reference}`,
    });

    this.eventsGateway.broadcastDataChange('contract:change', {
      action: 'permanent_deleted',
      id,
    });

    return result;
  }
}
