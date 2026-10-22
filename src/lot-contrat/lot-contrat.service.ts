import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LotContrat, LotContratDocument } from './schemas/lot-contrat.schema';
import { Contrat, ContratDocument } from '../contrat/schemas/contrat.schema';
import { Depense, DepenseDocument } from '../depense/schemas/depense.schema';
import { SettingService } from '../setting/setting.service';

@Injectable()
export class LotContratService {
  constructor(
    @InjectModel(LotContrat.name)
    private lotModel: Model<LotContratDocument>,
    @InjectModel(Contrat.name)
    private contratModel: Model<ContratDocument>,
    @InjectModel(Depense.name)
    private depenseModel: Model<DepenseDocument>,
    private settingService: SettingService,
  ) {}

  private readonly populateContrats = {
    path: 'contrats',
    model: 'Contrat',
    populate: [
      { path: 'car', model: 'Car', select: 'brand model matricule color' },
      { path: 'clients', model: 'Client', select: 'firstName lastName phone cin' },
    ],
  };

  extractRefNumber(ref?: string): number | null {
    if (!ref) return null;
    const trimmed = String(ref).trim();
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      return isNaN(num) ? null : num;
    }
    return null;
  }

  private filterContratsInInterval(lot: LotContratDocument): void {
    if (lot.contrats && lot.contrats.length > 0) {
      lot.contrats = (lot.contrats as any[]).filter((c) => {
        if (typeof c === 'object' && c && c.isDeleted) return false;
        const ref = typeof c === 'object' && c ? c.reference : undefined;
        const num = this.extractRefNumber(ref);
        return num !== null && num >= lot.startNumber && num <= lot.endNumber;
      });
    }
  }

  async findAll(filter?: { agenceId?: string; status?: string }): Promise<LotContratDocument[]> {
    const query: any = {};
    if (filter?.agenceId) {
      query.agence = new Types.ObjectId(filter.agenceId);
    }
    if (filter?.status) {
      query.status = filter.status;
    }
    return this.lotModel
      .find(query)
      .populate('agence')
      .populate('timbreDepense')
      .populate(this.populateContrats)
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string): Promise<LotContratDocument> {
    const lot = await this.lotModel
      .findById(id)
      .populate('agence')
      .populate('timbreDepense')
      .populate(this.populateContrats)
      .exec();
    if (!lot) {
      throw new NotFoundException(`Lot #${id} not found`);
    }
    return lot;
  }

  async getActiveByAgence(agenceId: string): Promise<LotContratDocument | null> {
    return this.lotModel
      .findOne({
        agence: new Types.ObjectId(agenceId),
        status: 'ouvert',
      })
      .populate('agence', 'name')
      .populate(this.populateContrats)
      .exec();
  }

  async getAllActive(): Promise<LotContratDocument[]> {
    return this.lotModel
      .find({ status: 'ouvert' })
      .populate('agence', 'name')
      .populate(this.populateContrats)
      .sort({ createdAt: -1 })
      .exec();
  }

  async getNextAvailableNumber(agenceId?: string): Promise<{
    recommendedStart: number;
    recommendedEnd: number;
    formattedStart: string;
    formattedEnd: string;
    lastUsedNumber: number;
    highestCarnetEnd: number;
  }> {
    let query: any = {};
    if (agenceId && Types.ObjectId.isValid(agenceId)) {
      query = { agence: new Types.ObjectId(agenceId) };
    }

    const carnets = await this.lotModel
      .find(query)
      .select('startNumber endNumber currentNumber numberPadding')
      .exec();

    let highestCarnetEnd = 0;
    let highestCarnetCurrent = 0;
    let defaultPadding = 6;

    for (const c of carnets) {
      if (c.endNumber > highestCarnetEnd) highestCarnetEnd = c.endNumber;
      if (c.currentNumber > highestCarnetCurrent) highestCarnetCurrent = c.currentNumber;
      if (c.numberPadding) defaultPadding = c.numberPadding;
    }

    // Inspect contracts in system to find highest existing numeric reference
    const contracts = await this.contratModel
      .find({}, 'reference car')
      .populate('car', 'agence')
      .exec();

    let highestContractRef = 0;
    for (const contrat of contracts) {
      const num = this.extractRefNumber(contrat.reference);
      if (num !== null && num > highestContractRef) {
        highestContractRef = num;
      }
    }

    const lastUsedNumber = Math.max(
      highestCarnetEnd,
      highestContractRef,
      highestCarnetCurrent > 0 ? highestCarnetCurrent - 1 : 0,
    );

    const recommendedStart = lastUsedNumber > 0 ? lastUsedNumber + 1 : 1;
    const recommendedEnd = recommendedStart + 49;

    return {
      recommendedStart,
      recommendedEnd,
      formattedStart: String(recommendedStart).padStart(defaultPadding, '0'),
      formattedEnd: String(recommendedEnd).padStart(defaultPadding, '0'),
      lastUsedNumber,
      highestCarnetEnd,
    };
  }

  async create(data: {
    name: string;
    agence: string;
    startNumber: number;
    endNumber: number;
    numberPadding?: number;
    closePrevious?: boolean;
    notes?: string;
  }): Promise<LotContratDocument> {
    if (!data.name || !data.agence) {
      throw new BadRequestException('Le nom et l\'agence sont requis.');
    }

    const startNum = Number(data.startNumber);
    const endNum = Number(data.endNumber);

    if (isNaN(startNum) || isNaN(endNum) || startNum < 0 || endNum < startNum) {
      throw new BadRequestException(
        'Les numéros de début et de fin sont invalides (fin >= début >= 0).',
      );
    }

    const agenceObjectId = new Types.ObjectId(data.agence);

    // Rule: Only one open lot per agency at any time
    const existingOpen = await this.lotModel.findOne({
      agence: agenceObjectId,
      status: 'ouvert',
    });

    if (existingOpen) {
      if (!data.closePrevious) {
        throw new ConflictException({
          message: 'OPEN_LOT_EXISTS',
          detail: `L'agence possède déjà un carnet ouvert : "${existingOpen.name}" (n° ${existingOpen.currentNumber}/${existingOpen.endNumber}).`,
          existingLot: existingOpen,
        });
      }
      // Close the previous active carnet
      await this.lotModel.findByIdAndUpdate(existingOpen._id, {
        status: 'ferme',
      });
    }

    const newLot = new this.lotModel({
      name: data.name.trim(),
      agence: agenceObjectId,
      startNumber: startNum,
      endNumber: endNum,
      currentNumber: startNum,
      numberPadding: data.numberPadding || 6,
      status: 'ouvert',
      notes: data.notes || '',
    });

    const saved = await newLot.save();
    return this.findOne(saved._id.toString());
  }

  async update(id: string, data: Partial<LotContrat>): Promise<LotContratDocument> {
    const lot = await this.lotModel
      .findByIdAndUpdate(id, data, { new: true })
      .populate('agence', 'name')
      .populate(this.populateContrats)
      .exec();
    if (!lot) {
      throw new NotFoundException(`Lot #${id} not found`);
    }
    return lot;
  }

  async closeLot(id: string): Promise<LotContratDocument> {
    const lot = await this.lotModel
      .findById(id)
      .populate('agence')
      .populate(this.populateContrats)
      .exec();

    if (!lot) {
      throw new NotFoundException(`Lot #${id} not found`);
    }

    if (lot.status !== 'ferme') {
      const settings = await this.settingService.getSettings();
      const agence = lot.agence as any;

      // Check if Timbre expense option is enabled on agency (default true unless explicitly false)
      const isAgencyTimbreActive = !agence || agence.applyTimbreExpense !== false;

      if (
        settings?.contractTaxEnabled &&
        (settings?.contractTaxValue || 0) > 0 &&
        isAgencyTimbreActive
      ) {
        let totalDays = 0;
        let validContratsCount = 0;

        if (lot.contrats && lot.contrats.length > 0) {
          for (const c of lot.contrats as any[]) {
            const status = String(c?.status || '').toLowerCase();
            if (status === 'cancelled' || status === 'annulé') continue;

            if (c.startDate && c.endDate) {
              const start = new Date(c.startDate).getTime();
              const end = new Date(c.endDate).getTime();
              const days = Math.max(
                1,
                Math.ceil((end - start) / (1000 * 60 * 60 * 24)),
              );
              totalDays += days;
              validContratsCount++;
            } else {
              totalDays += 1;
              validContratsCount++;
            }
          }
        }

        const timbreValue = Number(settings.contractTaxValue) || 0;
        const totalTimbreAmount =
          Math.round(totalDays * timbreValue * 100) / 100;

        if (totalTimbreAmount > 0) {
          let savedDepense: any;
          if (lot.timbreDepense) {
            savedDepense = await this.depenseModel.findByIdAndUpdate(
              lot.timbreDepense,
              {
                amount: totalTimbreAmount,
                date: new Date(),
                category: 'Frais sur contrat',
                description: `Frais sur contrat carnet « ${lot.name} » (${agence?.name || 'Agence'}) : ${totalDays} jour(s) de location (${validContratsCount} contrats à ${timbreValue} TND/jour)`,
              },
              { new: true },
            );
          }

          if (!savedDepense) {
            const created = new this.depenseModel({
              date: new Date(),
              amount: totalTimbreAmount,
              category: 'Frais sur contrat',
              description: `Frais sur contrat carnet « ${lot.name} » (${agence?.name || 'Agence'}) : ${totalDays} jour(s) de location (${validContratsCount} contrats à ${timbreValue} TND/jour)`,
            });
            savedDepense = await created.save();
          }

          lot.timbreDepense = savedDepense._id as any;
          lot.timbreAmount = totalTimbreAmount;
          lot.totalRentedDays = totalDays;
        }
      } else {
        if (lot.timbreDepense) {
          await this.depenseModel.findByIdAndDelete(lot.timbreDepense).exec();
          lot.timbreDepense = undefined;
        }
        lot.timbreAmount = 0;
      }

      lot.status = 'ferme';
      await lot.save();
    }

    return this.findOne(id);
  }

  async reopenLot(id: string, closeOther = false): Promise<LotContratDocument> {
    const lot = await this.findOne(id);
    const existingOpen = await this.lotModel.findOne({
      agence: lot.agence,
      status: 'ouvert',
      _id: { $ne: lot._id },
    });

    if (existingOpen) {
      if (!closeOther) {
        throw new ConflictException({
          message: 'OPEN_LOT_EXISTS',
          detail: `Un autre carnet est déjà ouvert pour cette agence : "${existingOpen.name}".`,
          existingLot: existingOpen,
        });
      }
      await this.closeLot(existingOpen._id.toString());
    }

    if (lot.timbreDepense) {
      await this.depenseModel.findByIdAndDelete(lot.timbreDepense).exec();
      lot.timbreDepense = undefined;
      lot.timbreAmount = 0;
      lot.totalRentedDays = 0;
      await lot.save();
    }

    return this.update(id, { status: 'ouvert' });
  }

  async findActiveLotForContract(params: {
    lotId?: string;
    agencyId?: string;
    agencyName?: string;
    reference?: string;
  }): Promise<LotContratDocument | null> {
    const refNum = this.extractRefNumber(params.reference);

    // If reference is explicitly provided but not a numeric carnet sequence number (e.g. "CTR-..."),
    // it MUST NOT belong to any carnet.
    if (params.reference && refNum === null) {
      return null;
    }

    // 1. Explicit lot ID
    if (params.lotId && Types.ObjectId.isValid(params.lotId)) {
      const lot = await this.lotModel
        .findById(params.lotId)
        .populate('agence', 'name')
        .exec();
      if (lot) {
        if (refNum !== null) {
          if (refNum >= lot.startNumber && refNum <= lot.endNumber) {
            return lot;
          }
          return null; // Reference is outside the requested lot's interval!
        }
        return lot;
      }
    }

    // If we have no numeric reference to test interval, do not auto-link
    if (refNum === null) {
      return null;
    }

    const activeLots = await this.getAllActive();

    // Filter lots that match the agency if agency is specified
    let agencyLots = activeLots;
    if (params.agencyId || params.agencyName) {
      const filtered = activeLots.filter((l) => {
        const agenceObj = l.agence as any;
        const agenceIdStr = agenceObj?._id
          ? agenceObj._id.toString()
          : agenceObj?.toString();
        const idMatches = Boolean(
          params.agencyId &&
            agenceIdStr &&
            agenceIdStr === params.agencyId.toString(),
        );
        const nameMatches = Boolean(
          params.agencyName &&
            agenceObj?.name &&
            agenceObj.name.trim().toLowerCase() ===
              params.agencyName.trim().toLowerCase(),
        );
        return idMatches || nameMatches;
      });
      if (filtered.length > 0) {
        agencyLots = filtered;
      }
    }

    // Must be strictly within [startNumber, endNumber]
    // a. Exact match with currentNumber
    const exactCurrent = agencyLots.find(
      (l) => l.currentNumber === refNum && refNum >= l.startNumber && refNum <= l.endNumber,
    );
    if (exactCurrent) return exactCurrent;

    // b. Falls within [startNumber, endNumber]
    const inRange = agencyLots.find(
      (l) => refNum >= l.startNumber && refNum <= l.endNumber,
    );
    if (inRange) return inRange;

    // Fallback across all active lots in case agency wasn't identified
    const anyRange = activeLots.find(
      (l) => refNum >= l.startNumber && refNum <= l.endNumber,
    );
    if (anyRange) return anyRange;

    return null;
  }

  async incrementCurrentNumber(
    id: string,
    usedNumber?: number,
  ): Promise<LotContratDocument | null> {
    const lot = await this.lotModel.findById(id).exec();
    if (!lot) return null;

    let next = lot.currentNumber + 1;
    if (
      typeof usedNumber === 'number' &&
      !isNaN(usedNumber) &&
      usedNumber >= lot.currentNumber
    ) {
      next = usedNumber + 1;
    }
    lot.currentNumber = next;

    // Automatically close if exhausted
    if (next > lot.endNumber) {
      lot.status = 'ferme';
    }

    return lot.save();
  }

  async addContratToLot(
    lotId: string,
    contratId: string,
    usedNumber?: number,
    increment = true,
  ): Promise<LotContratDocument | null> {
    const lot = await this.lotModel.findById(lotId).exec();
    if (!lot) return null;

    if (!lot.contrats) lot.contrats = [];
    const objId = new Types.ObjectId(contratId);
    const alreadyExists = lot.contrats.some(
      (c) => (c._id ? c._id.toString() : c.toString()) === contratId,
    );
    if (!alreadyExists) {
      lot.contrats.push(objId as any);
    }

    if (increment) {
      let next = lot.currentNumber + 1;
      if (
        typeof usedNumber === 'number' &&
        !isNaN(usedNumber) &&
        usedNumber >= lot.currentNumber
      ) {
        next = usedNumber + 1;
      }
      lot.currentNumber = next;

      // Automatically close if exhausted
      if (next > lot.endNumber) {
        lot.status = 'ferme';
      }
    }

    return lot.save();
  }

  async recalculateCurrentNumber(lotId: string): Promise<LotContratDocument> {
    const lot = await this.lotModel
      .findById(lotId)
      .populate('agence')
      .populate(this.populateContrats)
      .exec();

    if (!lot) {
      throw new NotFoundException(`Carnet #${lotId} not found`);
    }

    // 1. Gather all contract references attached to this carnet
    const attachedRefs: number[] = [];
    if (lot.contrats && lot.contrats.length > 0) {
      for (const c of lot.contrats as any[]) {
        if (!c || c.isDeleted) continue;
        const ref = typeof c === 'object' ? c.reference : undefined;
        const num = this.extractRefNumber(ref);
        if (num !== null && num >= lot.startNumber && num <= lot.endNumber) {
          attachedRefs.push(num);
        }
      }
    }

    // 2. Also check if there are existing contracts in the database within [startNumber, endNumber]
    // that should be linked to this carnet
    const inRangeContracts = await this.contratModel
      .find({})
      .select('_id reference lot')
      .exec();

    if (!lot.contrats) lot.contrats = [];

    for (const c of inRangeContracts) {
      const num = this.extractRefNumber(c.reference);
      if (num !== null && num >= lot.startNumber && num <= lot.endNumber) {
        if (!attachedRefs.includes(num)) {
          attachedRefs.push(num);
        }
        const alreadyInLot = (lot.contrats as any[]).some(
          (lc) => (lc._id ? lc._id.toString() : lc.toString()) === c._id.toString(),
        );
        if (!alreadyInLot) {
          lot.contrats.push(c._id as any);
          if (!c.lot || c.lot.toString() !== lot._id.toString()) {
            c.lot = lot._id as any;
            await c.save();
          }
        }
      }
    }

    // 3. Compute the next sequential number
    let calculatedNext = lot.startNumber;
    if (attachedRefs.length > 0) {
      const maxUsed = Math.max(...attachedRefs);
      calculatedNext = maxUsed + 1;
    }

    lot.currentNumber = calculatedNext;
    if (lot.currentNumber > lot.endNumber) {
      lot.status = 'ferme';
    }

    await lot.save();
    return this.findOne(lotId);
  }

  async removeContratFromLot(
    lotId: string,
    contratId: string,
  ): Promise<LotContratDocument | null> {
    return this.lotModel
      .findByIdAndUpdate(
        lotId,
        { $pull: { contrats: new Types.ObjectId(contratId) } },
        { new: true },
      )
      .exec();
  }

  async remove(id: string): Promise<any> {
    const res = await this.lotModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException(`Lot #${id} not found`);
    }
    return res;
  }

  async attachExistingContrat(
    lotId: string,
    contratId: string,
  ): Promise<LotContratDocument> {
    const lot = await this.lotModel.findById(lotId).exec();
    if (!lot) {
      throw new NotFoundException(`Carnet #${lotId} not found`);
    }
    const contrat = await this.contratModel.findById(contratId).exec();
    if (!contrat) {
      throw new NotFoundException(`Contrat #${contratId} not found`);
    }

    // Remove from previous lot if attached to a different lot
    if (contrat.lot && contrat.lot.toString() !== lotId) {
      await this.lotModel.findByIdAndUpdate(contrat.lot, {
        $pull: { contrats: contrat._id },
      }).exec();
    }

    // Add to this lot if not already there
    if (!lot.contrats) lot.contrats = [];
    const objId = new Types.ObjectId(contratId);
    const alreadyExists = lot.contrats.some(
      (c) => (c._id ? c._id.toString() : c.toString()) === contratId,
    );
    if (!alreadyExists) {
      lot.contrats.push(objId as any);
      await lot.save();
    }

    // Link contrat to this lot
    contrat.lot = lot._id as any;
    await (contrat as any).save();

    return this.findOne(lotId);
  }

  async attachMultipleContrats(
    lotId: string,
    contratIds: string[],
  ): Promise<LotContratDocument> {
    const lot = await this.lotModel.findById(lotId).exec();
    if (!lot) {
      throw new NotFoundException(`Carnet #${lotId} not found`);
    }
    if (!contratIds || contratIds.length === 0) {
      return this.findOne(lotId);
    }

    const objectIds = contratIds.map((id) => new Types.ObjectId(id));
    const contrats = await this.contratModel
      .find({ _id: { $in: objectIds } })
      .exec();

    // Pull from any previous lots
    const previousLotIds: Types.ObjectId[] = contrats
      .map((c) => c.lot)
      .filter((l): l is Types.ObjectId => Boolean(l && l.toString() !== lotId));

    if (previousLotIds.length > 0) {
      await this.lotModel
        .updateMany(
          { _id: { $in: previousLotIds } },
          { $pull: { contrats: { $in: objectIds } } as any },
        )
        .exec();
    }

    // Add all into this lot
    if (!lot.contrats) lot.contrats = [];
    const currentSet = new Set(
      lot.contrats.map((c) => (c._id ? c._id.toString() : c.toString())),
    );
    for (const objId of objectIds) {
      if (!currentSet.has(objId.toString())) {
        lot.contrats.push(objId as any);
        currentSet.add(objId.toString());
      }
    }
    await lot.save();

    // Link contracts to this lot
    await this.contratModel
      .updateMany(
        { _id: { $in: objectIds } },
        { $set: { lot: lot._id } },
      )
      .exec();

    return this.findOne(lotId);
  }

  async detachContrat(
    lotId: string,
    contratId: string,
  ): Promise<LotContratDocument> {
    const lot = await this.lotModel.findById(lotId).exec();
    if (!lot) {
      throw new NotFoundException(`Carnet #${lotId} not found`);
    }

    await this.lotModel.findByIdAndUpdate(lotId, {
      $pull: { contrats: new Types.ObjectId(contratId) },
    }).exec();

    await this.contratModel.findByIdAndUpdate(contratId, {
      $unset: { lot: 1 },
    }).exec();

    return this.findOne(lotId);
  }

  async cleanupOutOfRangeContrats(): Promise<{ cleanedLots: number; detachedContrats: number }> {
    const lots = await this.lotModel.find({}).exec();
    let cleanedLots = 0;
    let detachedContrats = 0;

    for (const lot of lots) {
      if (!lot.contrats || lot.contrats.length === 0) continue;

      const attachedContracts = await this.contratModel
        .find({ _id: { $in: lot.contrats } })
        .select('_id reference lot')
        .exec();

      const validIds: Types.ObjectId[] = [];
      const outOfRangeIds: Types.ObjectId[] = [];

      for (const c of attachedContracts) {
        const refNum = this.extractRefNumber(c.reference);
        if (refNum !== null && refNum >= lot.startNumber && refNum <= lot.endNumber) {
          validIds.push(c._id as Types.ObjectId);
        } else {
          outOfRangeIds.push(c._id as Types.ObjectId);
        }
      }

      if (outOfRangeIds.length > 0) {
        await this.lotModel.findByIdAndUpdate(lot._id, {
          $set: { contrats: validIds },
        }).exec();

        await this.contratModel.updateMany(
          { _id: { $in: outOfRangeIds } },
          { $unset: { lot: 1 } },
        ).exec();

        cleanedLots++;
        detachedContrats += outOfRangeIds.length;
      }
    }

    // Also scan all contracts with a lot link and unlink any whose code is not in interval
    const contractsWithLot = await this.contratModel
      .find({ lot: { $exists: true, $ne: null } })
      .populate('lot')
      .exec();

    for (const c of contractsWithLot) {
      const lot = c.lot as any;
      if (!lot || lot.startNumber === undefined || lot.endNumber === undefined) {
        await this.contratModel.findByIdAndUpdate(c._id, { $unset: { lot: 1 } });
        detachedContrats++;
        continue;
      }
      const refNum = this.extractRefNumber(c.reference);
      if (refNum === null || refNum < lot.startNumber || refNum > lot.endNumber) {
        await this.contratModel.findByIdAndUpdate(c._id, { $unset: { lot: 1 } });
        await this.lotModel.findByIdAndUpdate(lot._id, {
          $pull: { contrats: c._id },
        });
        detachedContrats++;
      }
    }

    return { cleanedLots, detachedContrats };
  }
}
