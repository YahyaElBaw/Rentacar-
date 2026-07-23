import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Car, CarDocument } from '../car/schemas/car.schema';
import { Contrat, ContratDocument } from '../contrat/schemas/contrat.schema';
import { Depense, DepenseDocument } from '../depense/schemas/depense.schema';
import { Client, ClientDocument } from '../client/schemas/client.schema';
import { Reservation, ReservationDocument } from '../reservation/schemas/reservation.schema';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    @InjectModel(Contrat.name) private contratModel: Model<ContratDocument>,
    @InjectModel(Depense.name) private depenseModel: Model<DepenseDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    @InjectModel(Reservation.name) private reservationModel: Model<ReservationDocument>,
  ) { }

  async getStats(user: any): Promise<any> {
    const isAdmin = user?.role === 'admin';
    const totalCars = await this.carModel.countDocuments({ disabled: { $ne: true } });
    const availableCars = await this.carModel.countDocuments({ isAvailable: true, disabled: { $ne: true } });
    const activeContrats = await this.contratModel.countDocuments({ status: 'active' });

    // Financial calculations
    const revenueResult = await this.contratModel.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    const totalRevenue = revenueResult[0]?.total || 0;

    const expenseResult = await this.depenseModel.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalExpenses = expenseResult[0]?.total || 0;

    return {
      kpis: {
        totalCars,
        availableCars,
        rentedCars: totalCars - availableCars,
        activeContrats,
        totalRevenue: isAdmin ? totalRevenue : 0,
        totalExpenses: isAdmin ? totalExpenses : 0,
        netProfit: isAdmin ? totalRevenue - totalExpenses : 0
      },
      recentContracts: await this.contratModel.find().sort({ createdAt: -1 }).limit(5).populate('car').exec(),
      todayActions: await this.getTodayActions(),
      alerts: await this.getAlerts(),
      history: isAdmin ? await this.getWeeklyHistory() : []
    };
  }

  private async getTodayActions(): Promise<any[]> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const matchQuery = {
      $or: [
        { startDate: { $gte: todayStart, $lte: todayEnd } },
        { endDate: { $gte: todayStart, $lte: todayEnd } }
      ],
      status: { $ne: 'cancelled' }
    };

    const contracts = await this.contratModel.find(matchQuery)
      .populate({ path: 'car', model: 'Car' })
      .populate({ path: 'clients', model: 'Client' })
      .lean()
      .exec();

    const reservations = await this.reservationModel.find({
      ...matchQuery,
      contrat: null // Only show reservations that aren't converted to contracts yet
    })
      .populate({ path: 'car', model: 'Car' })
      .populate({ path: 'clients', model: 'Client' })
      .lean()
      .exec();

    const actions = [];

    // Process Contracts
    for (const contrat of contracts) {
      // Skip if car is disabled
      if ((contrat.car as any)?.disabled) continue;

      // Robust normalization of clients
      let normalizedClients = [];
      const rawClients = (contrat.clients && contrat.clients.length > 0) ? contrat.clients : ((contrat as any).client ? [(contrat as any).client] : []);

      let hasDisabledClient = false;
      for (const c of rawClients) {
        let clientObj: any = null;
        if (c && typeof c === 'object' && (c as any).lastName) {
          clientObj = c;
        } else if (c) {
          clientObj = await this.clientModel.findById(c).lean().exec();
        }
        
        if (clientObj) {
          if (clientObj.disabled) {
            hasDisabledClient = true;
            break;
          }
          normalizedClients.push(clientObj);
        }
      }

      if (hasDisabledClient) continue;

      const firstClient = normalizedClients[0] as any;
      const clientName = firstClient ? `${firstClient.lastName} ${firstClient.firstName}`.trim().toUpperCase() : '—';
      const clientPhone = firstClient ? (firstClient.phone || 'Pas de tél') : 'Pas de tél';

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
          status: contrat.status
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
          status: contrat.status
        });
      }
    }

    // Process Reservations
    for (const res of reservations) {
      // Skip if car is disabled
      if ((res.car as any)?.disabled) continue;

      let normalizedClients = [];
      const rawClients = (res.clients && res.clients.length > 0) ? res.clients : ((res as any).client ? [(res as any).client] : []);

      let hasDisabledClient = false;
      for (const c of rawClients) {
        let clientObj: any = null;
        if (c && typeof c === 'object' && (c as any).lastName) {
          clientObj = c;
        } else if (c) {
          clientObj = await this.clientModel.findById(c).lean().exec();
        }

        if (clientObj) {
          if (clientObj.disabled) {
            hasDisabledClient = true;
            break;
          }
          normalizedClients.push(clientObj);
        }
      }

      if (hasDisabledClient) continue;

      const firstClient = normalizedClients[0] as any;
      const clientName = firstClient ? `${firstClient.lastName} ${firstClient.firstName}`.trim().toUpperCase() : '—';
      const clientPhone = firstClient ? (firstClient.phone || 'Pas de tél') : 'Pas de tél';

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
          status: res.status
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
          status: res.status
        });
      }
    }

    // Sort by date/time
    return actions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  private async getWeeklyHistory(): Promise<any> {
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);

    const revenueHistory = await this.aggregateDaily(this.contratModel, 'totalAmount', sevenDaysAgo);
    const expenseHistory = await this.aggregateDaily(this.depenseModel, 'amount', sevenDaysAgo);

    // Merge and calculate profit
    const history = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(today.getDate() - (6 - i));
      const dateStr = date.toISOString().split('T')[0];

      const rev = revenueHistory.find(r => r._id === dateStr)?.total || 0;
      const exp = expenseHistory.find(e => e._id === dateStr)?.total || 0;

      history.push({
        date: dateStr,
        revenue: rev,
        profit: rev - exp
      });
    }

    return history;
  }

  private async aggregateDaily(model: Model<any>, amountField: string, since: Date): Promise<any[]> {
    return model.aggregate([
      {
        $match: {
          $or: [
            { createdAt: { $gte: since } },
            { date: { $gte: since } }, // For Depense
            { startDate: { $gte: since } } // For Contrat
          ]
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: { $ifNull: ["$date", { $ifNull: ["$startDate", "$createdAt"] }] } }
          },
          total: { $sum: `$${amountField}` }
        }
      },
      { $sort: { _id: 1 } }
    ]);
  }

  private async getAlerts(): Promise<any[]> {
    const alerts = [];
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    const cars = await this.carModel.find({ disabled: { $ne: true } }).exec();
    for (const car of cars) {
      // Vidange alert: before 3000km
      if (car.nextOilChangeMileage) {
        const remainingKm = car.nextOilChangeMileage - car.mileage;
        if (remainingKm <= 3000) {
          alerts.push({
            code: 'VIDANGE',
            type: remainingKm <= 500 ? 'critique' : 'urgent',
            carId: car._id,
            carBrand: car.brand,
            carModel: car.model,
            carMatricule: car.matricule,
            currentMileage: car.mileage,
            message: remainingKm <= 0
              ? `Vidange DÉPASSÉE pour ${car.brand} ${car.model} (${car.matricule})! Surplus: ${Math.abs(remainingKm)} KM.`
              : `Vidange nécessaire pour ${car.brand} ${car.model} (${car.matricule}). Reste: ${remainingKm} KM.`
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
          if (daysLeft < 0) alertMsg += `en retard de ${Math.abs(daysLeft)} jours.`;
          else if (daysLeft === 0) alertMsg += `expire aujourd'hui!`;
          else alertMsg += `expire dans ${daysLeft} jours.`;

          alerts.push({
            code: 'VISITE',
            type: daysLeft <= 15 ? 'critique' : 'urgent',
            carId: car._id,
            carBrand: car.brand,
            carModel: car.model,
            carMatricule: car.matricule,
            message: alertMsg
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
          if (daysLeft < 0) alertMsg += `expirée il y a ${Math.abs(daysLeft)} jours.`;
          else if (daysLeft === 0) alertMsg += `expire aujourd'hui!`;
          else alertMsg += `expire dans ${daysLeft} jours.`;

          alerts.push({
            code: 'ASSURANCE',
            type: daysLeft <= 7 ? 'critique' : 'urgent',
            carId: car._id,
            carBrand: car.brand,
            carModel: car.model,
            carMatricule: car.matricule,
            message: alertMsg
          });
        }
      }
    }

    // Incomplete Client Info Basics
    const incompleteClients = await this.clientModel.find({
      disabled: { $ne: true },
      $or: [
        { cin: { $in: [null, ''] } },
        { drivingLicense: { $in: [null, ''] } },
        { birthday: null },
        { address: { $in: [null, ''] } },
        { cinFront: { $in: [null, ''] } },
        { $and: [{ idCardType: { $ne: 'passport' } }, { cinBack: { $in: [null, ''] } }] },
        { licenseFront: { $in: [null, ''] } },
        { licenseBack: { $in: [null, ''] } }
      ]
    }).limit(10).exec();

    for (const client of incompleteClients) {
      alerts.push({
        type: 'info',
        code: 'INCOMPLETE_CLIENT',
        message: `Dossier incomplet pour ${client.firstName} ${client.lastName}.`,
        clientId: client._id
      });
    }

    return alerts;
  }
}
