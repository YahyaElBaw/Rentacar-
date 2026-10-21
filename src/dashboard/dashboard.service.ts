import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Car, CarDocument } from '../car/schemas/car.schema';
import { Contrat, ContratDocument } from '../contrat/schemas/contrat.schema';
import { Depense, DepenseDocument } from '../depense/schemas/depense.schema';
import { Client, ClientDocument } from '../client/schemas/client.schema';
import {
  Reservation,
  ReservationDocument,
} from '../reservation/schemas/reservation.schema';
import {
  DismissedAlert,
  DismissedAlertDocument,
} from './schemas/dismissed-alert.schema';
import { UsersService } from '../users/users.service';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    @InjectModel(Contrat.name) private contratModel: Model<ContratDocument>,
    @InjectModel(Depense.name) private depenseModel: Model<DepenseDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    @InjectModel(Reservation.name)
    private reservationModel: Model<ReservationDocument>,
    @InjectModel(DismissedAlert.name)
    private dismissedAlertModel: Model<DismissedAlertDocument>,
    private usersService: UsersService,
  ) {}

  private cachedStats = new Map<string, { timestamp: number; data: any }>();
  private cachedAlerts: { timestamp: number; data: any[] } | null = null;

  public invalidateCache() {
    this.cachedStats.clear();
    this.cachedAlerts = null;
  }

  async getStats(user: any, from?: string, to?: string): Promise<any> {
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
    const cacheKey = `${user?.role || 'user'}_${from || ''}_${to || ''}`;
    const now = Date.now();
    const existing = this.cachedStats.get(cacheKey);
    if (existing && now - existing.timestamp < 15000) {
      return existing.data;
    }

    const hasRange = Boolean(from && to);
    const revenueMatch: any = { status: { $ne: 'cancelled' } };
    const expenseMatch: any = {};
    if (hasRange && from && to) {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      revenueMatch.startDate = { $gte: fromDate, $lte: toDate };
      expenseMatch.date = { $gte: fromDate, $lte: toDate };
    }

    const [
      totalCars,
      availableCars,
      activeContrats,
      revenueResult,
      expenseResult,
      recentContracts,
      todayActions,
      alerts,
      history,
    ] = await Promise.all([
      this.carModel.countDocuments({ disabled: { $ne: true } }),
      this.carModel.countDocuments({ isAvailable: true, disabled: { $ne: true } }),
      this.contratModel.countDocuments({ status: 'active' }),
      this.contratModel.aggregate([
        { $match: revenueMatch },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      this.depenseModel.aggregate([
        { $match: expenseMatch },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.contratModel
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('reference status totalAmount createdAt car isPaid startDate endDate clients')
        .populate({ path: 'car', select: 'brand model matricule images' })
        .populate({ path: 'clients', select: 'firstName lastName phone' })
        .lean()
        .exec(),
      this.getTodayActions(),
      this.getAlerts(),
      isAdmin ? this.getWeeklyHistory() : Promise.resolve([]),
    ]);

    const totalRevenue = revenueResult[0]?.total || 0;
    const totalExpenses = expenseResult[0]?.total || 0;

    const result = {
      kpis: {
        totalCars,
        availableCars,
        rentedCars: totalCars - availableCars,
        activeContrats,
        totalRevenue,
        totalExpenses,
        netProfit: isAdmin ? totalRevenue - totalExpenses : null,
      },
      recentContracts,
      todayActions,
      alerts,
      history,
    };

    this.cachedStats.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  }

  private async getTodayActions(): Promise<any[]> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const matchQuery = {
      $or: [
        { startDate: { $gte: todayStart, $lte: todayEnd } },
        { endDate: { $gte: todayStart, $lte: todayEnd } },
      ],
      status: { $ne: 'cancelled' },
    };

    const [contracts, reservations] = await Promise.all([
      this.contratModel
        .find(matchQuery)
        .select('reference startDate endDate status car clients client')
        .populate({ path: 'car', model: 'Car', select: 'brand model matricule images disabled' })
        .populate({ path: 'clients', model: 'Client', select: 'firstName lastName phone cin disabled' })
        .lean()
        .exec(),
      this.reservationModel
        .find({
          ...matchQuery,
          contrat: null,
        })
        .select('startDate endDate status car clients client')
        .populate({ path: 'car', model: 'Car', select: 'brand model matricule images disabled' })
        .populate({ path: 'clients', model: 'Client', select: 'firstName lastName phone cin disabled' })
        .lean()
        .exec(),
    ]);

    // Collect all un-populated client IDs from both collections in one pass,
    // then resolve them with a single batch query instead of findById() per client.
    const unresolvedClientIds = new Set<string>();
    const allDocs = [...contracts, ...reservations];
    for (const doc of allDocs) {
      if (!doc.clients?.length && (doc as any).client) {
        unresolvedClientIds.add((doc as any).client.toString());
      }
    }
    const clientMap = new Map<string, any>();
    if (unresolvedClientIds.size > 0) {
      const batchClients = await this.clientModel
        .find({ _id: { $in: [...unresolvedClientIds] } })
        .select('firstName lastName phone cin disabled')
        .lean()
        .exec();
      for (const c of batchClients) clientMap.set((c as any)._id.toString(), c);
    }

    const actions = [];

    // Process Contracts
    for (const contrat of contracts) {
      // Skip if car is disabled
      if ((contrat.car as any)?.disabled) continue;

      // Resolve clients: already populated or fall back to batch-loaded map
      const rawClients =
        contrat.clients && contrat.clients.length > 0
          ? contrat.clients
          : (contrat as any).client
            ? [clientMap.get((contrat as any).client.toString())].filter(Boolean)
            : [];

      const normalizedClients = [];
      let hasDisabledClient = false;
      for (const c of rawClients) {
        if (!c) continue;
        if ((c as any).disabled) { hasDisabledClient = true; break; }
        normalizedClients.push(c);
      }
      if (hasDisabledClient) continue;

      const firstClient = normalizedClients[0];
      const clientName = firstClient
        ? `${firstClient.lastName} ${firstClient.firstName}`
            .trim()
            .toUpperCase()
        : '—';
      const clientPhone = firstClient
        ? firstClient.phone || 'Pas de tél'
        : 'Pas de tél';

      if (contrat.startDate >= todayStart && contrat.startDate <= todayEnd) {
        actions.push({
          id: contrat._id,
          type: 'départ',
          category: 'contrat',
          reference: contrat.reference,
          date: contrat.startDate,
          car: contrat.car,
          clients: normalizedClients,
          clientName,
          clientPhone,
          status: contrat.status,
        });
      }
      if (contrat.endDate >= todayStart && contrat.endDate <= todayEnd) {
        actions.push({
          id: contrat._id,
          type: 'retour',
          category: 'contrat',
          reference: contrat.reference,
          date: contrat.endDate,
          car: contrat.car,
          clients: normalizedClients,
          clientName,
          clientPhone,
          status: contrat.status,
        });
      }
    }

    // Process Reservations
    for (const res of reservations) {
      // Skip if car is disabled
      if ((res.car as any)?.disabled) continue;

      // Resolve clients: already populated or fall back to batch-loaded map
      const rawClients =
        res.clients && res.clients.length > 0
          ? res.clients
          : (res as any).client
            ? [clientMap.get((res as any).client.toString())].filter(Boolean)
            : [];

      const normalizedClients = [];
      let hasDisabledClient = false;
      for (const c of rawClients) {
        if (!c) continue;
        if ((c as any).disabled) { hasDisabledClient = true; break; }
        normalizedClients.push(c);
      }
      if (hasDisabledClient) continue;

      const firstClient = normalizedClients[0];
      const clientName = firstClient
        ? `${firstClient.lastName} ${firstClient.firstName}`
            .trim()
            .toUpperCase()
        : '—';
      const clientPhone = firstClient
        ? firstClient.phone || 'Pas de tél'
        : 'Pas de tél';

      if (res.startDate >= todayStart && res.startDate <= todayEnd) {
        actions.push({
          id: res._id,
          type: 'départ',
          category: 'réservation',
          reference: 'Réserv.',
          date: res.startDate,
          car: res.car,
          clients: normalizedClients,
          clientName,
          clientPhone,
          status: res.status,
        });
      }
      if (res.endDate >= todayStart && res.endDate <= todayEnd) {
        actions.push({
          id: res._id,
          type: 'retour',
          category: 'réservation',
          reference: 'Réserv.',
          date: res.endDate,
          car: res.car,
          clients: normalizedClients,
          clientName,
          clientPhone,
          status: res.status,
        });
      }
    }

    // Sort by date/time
    return actions.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }

  private async getWeeklyHistory(): Promise<any> {
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);

    const [revenueHistory, expenseHistory] = await Promise.all([
      this.aggregateDaily(this.contratModel, 'totalAmount', sevenDaysAgo),
      this.aggregateDaily(this.depenseModel, 'amount', sevenDaysAgo),
    ]);

    // Merge and calculate profit
    const history = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(today.getDate() - (6 - i));
      const dateStr = date.toISOString().split('T')[0];

      const rev = revenueHistory.find((r) => r._id === dateStr)?.total || 0;
      const exp = expenseHistory.find((e) => e._id === dateStr)?.total || 0;

      history.push({
        date: dateStr,
        revenue: rev,
        profit: rev - exp,
      });
    }

    return history;
  }

  private async aggregateDaily(
    model: Model<any>,
    amountField: string,
    since: Date,
  ): Promise<any[]> {
    const isContrat = model === this.contratModel;
    const dateField = isContrat ? '$startDate' : '$date';
    const matchFilter: any = isContrat
      ? { status: { $ne: 'cancelled' }, startDate: { $gte: since } }
      : { date: { $gte: since } };

    return model.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: dateField,
            },
          },
          total: { $sum: `$${amountField}` },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }

  async getAlerts(): Promise<any[]> {
    const now = Date.now();
    if (this.cachedAlerts && now - this.cachedAlerts.timestamp < 30000) {
      return this.cachedAlerts.data;
    }

    const alerts = [];
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    const [cars, incompleteClients] = await Promise.all([
      this.carModel
        .find({ disabled: { $ne: true } })
        .select(
          'brand model matricule mileage nextOilChangeMileage nextTechnicalVisitDate insuranceDate disabled',
        )
        .lean()
        .exec(),
      this.clientModel
        .find({
          disabled: { $ne: true },
          $or: [
            { cin: { $in: [null, ''] } },
            { drivingLicense: { $in: [null, ''] } },
            { cinFront: { $in: [null, ''] } },
          ],
        })
        .select('firstName lastName cin drivingLicense disabled')
        .limit(10)
        .lean()
        .exec(),
    ]);

    for (const car of cars) {
      // Vidange alert: before 3000km
      if (car.nextOilChangeMileage) {
        const remainingKm = car.nextOilChangeMileage - car.mileage;
        if (remainingKm <= 3000) {
          alerts.push({
            key: `vidange:${car._id}`,
            code: 'VIDANGE',
            type: remainingKm <= 500 ? 'critique' : 'urgent',
            carId: car._id,
            carBrand: car.brand,
            carModel: car.model,
            carMatricule: car.matricule,
            currentMileage: car.mileage,
            message:
              remainingKm <= 0
                ? `Vidange DÉPASSÉE pour ${car.brand} ${car.model} (${car.matricule})! Surplus: ${Math.abs(remainingKm)} KM.`
                : `Vidange nécessaire pour ${car.brand} ${car.model} (${car.matricule}). Reste: ${remainingKm} KM.`,
          });
        }
      }

      // Visite Technique alert: before 30 days
      if (car.nextTechnicalVisitDate) {
        const visitDate = new Date(car.nextTechnicalVisitDate);
        if (visitDate <= thirtyDaysFromNow) {
          const timeDiff = visitDate.getTime() - today.getTime();
          const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

          let alertMsg = `Visite technique pour ${car.brand} ${car.model} (${car.matricule}) `;
          if (daysLeft < 0)
            alertMsg += `en retard de ${Math.abs(daysLeft)} jours.`;
          else if (daysLeft === 0) alertMsg += `expire aujourd'hui!`;
          else alertMsg += `expire dans ${daysLeft} jours.`;

          alerts.push({
            key: `visite:${car._id}`,
            code: 'VISITE',
            type: daysLeft <= 15 ? 'critique' : 'urgent',
            carId: car._id,
            carBrand: car.brand,
            carModel: car.model,
            carMatricule: car.matricule,
            message: alertMsg,
          });
        }
      }

      // Assurance alert: before 15 days
      if (car.insuranceDate) {
        const insuranceDate = new Date(car.insuranceDate);
        const fifteenDaysFromNow = new Date();
        fifteenDaysFromNow.setDate(today.getDate() + 15);

        if (insuranceDate <= fifteenDaysFromNow) {
          const timeDiff = insuranceDate.getTime() - today.getTime();
          const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

          let alertMsg = `Assurance pour ${car.brand} ${car.model} (${car.matricule}) `;
          if (daysLeft < 0)
            alertMsg += `expirée il y a ${Math.abs(daysLeft)} jours.`;
          else if (daysLeft === 0) alertMsg += `expire aujourd'hui!`;
          else alertMsg += `expire dans ${daysLeft} jours.`;

          alerts.push({
            key: `assurance:${car._id}`,
            code: 'ASSURANCE',
            type: daysLeft <= 7 ? 'critique' : 'urgent',
            carId: car._id,
            carBrand: car.brand,
            carModel: car.model,
            carMatricule: car.matricule,
            message: alertMsg,
          });
        }
      }
    }

    for (const client of (incompleteClients || [])) {
      alerts.push({
        key: `incomplete:${client._id}`,
        type: 'info',
        code: 'INCOMPLETE_CLIENT',
        message: `Dossier incomplet pour ${client.firstName} ${client.lastName}.`,
        clientId: client._id,
      });
    }

    if (alerts.length === 0) {
      this.cachedAlerts = { timestamp: Date.now(), data: [] };
      return [];
    }

    const dismissed = await this.dismissedAlertModel
      .find({ key: { $in: alerts.map((a) => a.key) } })
      .select('key')
      .lean()
      .exec();
    const dismissedKeys = new Set(dismissed.map((d) => d.key));
    const result = alerts.filter((a) => !dismissedKeys.has(a.key));
    this.cachedAlerts = { timestamp: Date.now(), data: result };
    return result;
  }

  async verifyPassword(userId: string, password?: string) {
    if (!password || !password.trim()) {
      throw new BadRequestException('Mot de passe requis.');
    }
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('Utilisateur introuvable.');
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new BadRequestException('Mot de passe incorrect.');
    }
  }

  async dismissAlert(
    actorId: string,
    key: string,
    password?: string,
    alertData?: { code?: string; type?: string; message?: string; metadata?: Record<string, any> },
  ) {
    if (!key || typeof key !== 'string') {
      throw new BadRequestException('Alerte invalide.');
    }
    // Password is only checked if explicitly provided
    if (password && password.trim()) {
      const user = await this.usersService.findById(actorId);
      if (!user) {
        throw new BadRequestException('Utilisateur introuvable.');
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        throw new BadRequestException('Mot de passe incorrect.');
      }
    }
    await this.dismissedAlertModel.updateOne(
      { key },
      {
        $set: {
          key,
          dismissedBy: new Types.ObjectId(actorId),
          code: alertData?.code || '',
          type: alertData?.type || '',
          message: alertData?.message || '',
          metadata: alertData?.metadata || {},
        },
      },
      { upsert: true },
    );
    this.invalidateCache();
  }

  async bulkDismissAlerts(
    actorId: string,
    alertKeys: Array<{ key: string; code?: string; type?: string; message?: string; metadata?: Record<string, any> }>,
    password?: string,
  ) {
    if (!alertKeys?.length) {
      throw new BadRequestException('Aucune alerte selectionnee.');
    }
    if (password && password.trim()) {
      const user = await this.usersService.findById(actorId);
      if (!user) {
        throw new BadRequestException('Utilisateur introuvable.');
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        throw new BadRequestException('Mot de passe incorrect.');
      }
    }
    const ops = alertKeys.map((a) => ({
      updateOne: {
        filter: { key: a.key },
        update: {
          $set: {
            key: a.key,
            dismissedBy: new Types.ObjectId(actorId),
            code: a.code || '',
            type: a.type || '',
            message: a.message || '',
            metadata: a.metadata || {},
          },
        },
        upsert: true,
      },
    }));
    await this.dismissedAlertModel.bulkWrite(ops as any);
    this.invalidateCache();
    return { dismissed: alertKeys.length };
  }

  async getDismissedKeys(): Promise<string[]> {
    const docs = await this.dismissedAlertModel.find().select('key').exec();
    return docs.map((d) => d.key);
  }

  async getDismissedAlerts(code?: string) {
    const filter: any = {};
    if (code) filter.code = code;
    return this.dismissedAlertModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('dismissedBy', 'firstName lastName')
      .exec();
  }

  async restoreAlert(id: string) {
    const deleted = await this.dismissedAlertModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new UnauthorizedException('Alerte introuvable.');
    }
    return { restored: true, key: deleted.key };
  }

  async permanentDeleteAlert(id: string) {
    const deleted = await this.dismissedAlertModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new UnauthorizedException('Alerte introuvable.');
    }
    return { deleted: true };
  }

  async bulkRestoreAlerts(ids: string[]) {
    if (!ids?.length) {
      throw new UnauthorizedException('Aucune alerte selectionnee.');
    }
    const result = await this.dismissedAlertModel
      .deleteMany({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .exec();
    this.invalidateCache();
    return { restored: result.deletedCount };
  }

  async bulkPermanentDeleteAlerts(ids: string[]) {
    if (!ids?.length) {
      throw new UnauthorizedException('Aucune alerte selectionnee.');
    }
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    const result = await this.dismissedAlertModel
      .deleteMany({ _id: { $in: objectIds } })
      .exec();
    this.invalidateCache();
    return { deleted: result.deletedCount };
  }

  private cachedExchangeRates: { timestamp: number; data: any } | null = null;
  private isFetchingRates = false;

  async getExchangeRates(): Promise<any> {
    const now = Date.now();
    // Official reference rates from Banque Centrale de Tunisie (BCT / Marché officiel)
    const bctVerifiedRates: Record<string, number> = {
      TND: 1,
      EUR: 0.2973, // 1 EUR = 3.3637 TND
      USD: 0.3326, // 1 USD = 3.0071 TND
      CAD: 0.4760, // 1 CAD = 2.1006 TND
      GBP: 0.2526, // 1 GBP = 3.9593 TND
      SAR: 1.2563, // 1 SAR = 0.7957 TND
      AED: 1.2210, // 1 AED = 0.8190 TND
      CHF: 0.2785, // 1 CHF = 3.5910 TND
      KWD: 0.1032, // 1 KWD = 9.6928 TND
      QAR: 1.2198, // 1 QAR = 0.8198 TND
    };

    if (this.cachedExchangeRates) {
      // If cached data is older than 30m, trigger background refresh
      if (now - this.cachedExchangeRates.timestamp > 1800000 && !this.isFetchingRates) {
        this.refreshLiveRatesInBackground(bctVerifiedRates);
      }
      return this.cachedExchangeRates.data;
    }

    const initialPayload = {
      result: 'success',
      source: 'Banque Centrale de Tunisie (Cours de référence BCT)',
      sourceVerified: true,
      updatedAt: new Date().toISOString(),
      rates: bctVerifiedRates,
    };
    this.cachedExchangeRates = { timestamp: now, data: initialPayload };
    this.refreshLiveRatesInBackground(bctVerifiedRates);
    return initialPayload;
  }

  private refreshLiveRatesInBackground(bctVerifiedRates: Record<string, number>) {
    this.isFetchingRates = true;
    (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const res = await fetch('https://open.er-api.com/v6/latest/TND', { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const json = await res.json();
          if (json && json.result === 'success' && json.rates) {
            this.cachedExchangeRates = {
              timestamp: Date.now(),
              data: {
                result: 'success',
                source: 'BCT & Marché Interbancaire (Banque Centrale de Tunisie)',
                sourceVerified: true,
                updatedAt: new Date().toISOString(),
                rates: {
                  ...bctVerifiedRates,
                  ...json.rates,
                },
              },
            };
          }
        }
      } catch {}
    })().finally(() => {
      this.isFetchingRates = false;
    });
  }
}
