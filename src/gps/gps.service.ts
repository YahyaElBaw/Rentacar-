import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Car, CarDocument } from '../car/schemas/car.schema';
import {
  CarPosition,
  CarPositionDocument,
} from './schemas/car-position.schema';
import {
  SpeedAlert,
  SpeedAlertDocument,
} from './schemas/speed-alert.schema';
import { Contrat, ContratDocument } from '../contrat/schemas/contrat.schema';
import { Setting, SettingDocument } from '../setting/schemas/setting.schema';
import { EventsGateway } from '../events/events.gateway';

const normalizePlate = (plate: string) =>
  String(plate || '')
    .toUpperCase()
    .replace(/[\s\-_.]/g, '');

// Default speed alert threshold (can be changed from Settings)
export const SPEED_ALERT_THRESHOLD_KMH = 130;
const SPEED_ALERT_COOLDOWN_MS = 5 * 60 * 1000; // one alert per car per 5 minutes
const SPEED_LIMIT_CACHE_TTL_MS = 30 * 1000;

/** Day key YYYY-MM-DD in Tunisia local time (UTC+1, no DST) */
function tunisiaDayKey(d: Date): string {
  const shifted = new Date(d.getTime() + 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

@Injectable()
export class GpsService {
  private readonly logger = new Logger(GpsService.name);
  private speedLimitCache: { value: number; loadedAt: number } = {
    value: SPEED_ALERT_THRESHOLD_KMH,
    loadedAt: 0,
  };

  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    @InjectModel(CarPosition.name)
    private carPositionModel: Model<CarPositionDocument>,
    @InjectModel(SpeedAlert.name)
    private speedAlertModel: Model<SpeedAlertDocument>,
    @InjectModel(Contrat.name)
    private contratModel: Model<ContratDocument>,
    @InjectModel(Setting.name)
    private settingModel: Model<SettingDocument>,
    private eventsGateway: EventsGateway,
  ) {}

  /** Configurable alert threshold (floating number) with a short cache */
  private async getSpeedAlertLimit(): Promise<number> {
    if (Date.now() - this.speedLimitCache.loadedAt < SPEED_LIMIT_CACHE_TTL_MS) {
      return this.speedLimitCache.value;
    }
    try {
      const settings = await this.settingModel
        .findOne()
        .select('speedAlertLimit')
        .lean()
        .exec();
      const value = Number((settings as any)?.speedAlertLimit);
      if (Number.isFinite(value) && value > 0) {
        this.speedLimitCache.value = value;
      }
      this.speedLimitCache.loadedAt = Date.now();
    } catch (err) {
      this.logger.warn(`Failed to load speed limit setting: ${String(err)}`);
      this.speedLimitCache.loadedAt = Date.now();
    }
    return this.speedLimitCache.value;
  }

  /** Called by SettingService when settings are updated to pick up new limits immediately */
  resetSettingsCache(): void {
    this.speedLimitCache.loadedAt = 0;
  }

  private carsCache: { list: CarDocument[]; loadedAt: number } = {
    list: [],
    loadedAt: 0,
  };
  private rentedCarIdsCache: { set: Set<string>; loadedAt: number } = {
    set: new Set(),
    loadedAt: 0,
  };

  private async getCachedCars(): Promise<CarDocument[]> {
    const now = Date.now();
    if (now - this.carsCache.loadedAt < 30_000 && this.carsCache.list.length > 0) {
      return this.carsCache.list;
    }
    try {
      const cars = await this.carModel.find().exec();
      this.carsCache = { list: cars, loadedAt: now };
      return cars;
    } catch (err) {
      this.logger.error(`Failed to refresh cars cache: ${err}`);
      return this.carsCache.list;
    }
  }

  private async getRentedCarIds(): Promise<Set<string>> {
    const now = Date.now();
    if (now - this.rentedCarIdsCache.loadedAt < 15_000) {
      return this.rentedCarIdsCache.set;
    }
    try {
      const nowDate = new Date();
      const activeContrats = await this.contratModel
        .find(
          {
            status: { $in: ['active', 'soon'] },
            startDate: { $lte: nowDate },
            endDate: { $gte: nowDate },
          },
          { car: 1 },
        )
        .lean()
        .exec();
      const set = new Set<string>(
        activeContrats.map((c: any) => String(c.car)),
      );
      this.rentedCarIdsCache = { set, loadedAt: now };
      return set;
    } catch (err) {
      return this.rentedCarIdsCache.set;
    }
  }

  /** True when the car currently has an active/soon contract spanning now (cached) */
  private async isCarRented(carId: Types.ObjectId): Promise<boolean> {
    const set = await this.getRentedCarIds();
    return set.has(String(carId));
  }

  async ingest(dto: {
    imei?: string;
    plate?: string;
    provider?: string;
    lat: number;
    lng: number;
    speed?: number;
    at?: string | Date;
    heading?: number;
  }): Promise<{ accepted: boolean; reason?: string; carId?: string }> {
    const cars = await this.getCachedCars();
    const normalizedPlate = dto.plate ? normalizePlate(dto.plate) : '';

    const car = cars.find((c) => {
      if (normalizedPlate && normalizePlate(c.matricule) === normalizedPlate) {
        return true;
      }
      if (dto.imei && (c as any).gpsImei && String((c as any).gpsImei) === dto.imei) {
        return true;
      }
      return false;
    });

    if (!car) {
      return { accepted: false, reason: 'Véhicule introuvable' };
    }

    const positionAt = dto.at ? new Date(dto.at) : new Date();
    const speed = Number(dto.speed) || 0;
    const isRented = await this.isCarRented(car._id);

    await this.carPositionModel.findOneAndUpdate(
      { carId: car._id },
      {
        $set: {
          carId: car._id,
          matricule: car.matricule,
          brand: car.brand,
          model: car.model,
          lat: dto.lat,
          lng: dto.lng,
          speed,
          heading: dto.heading ?? 0,
          provider: dto.provider || 'unknown',
          positionAt,
          isRented,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );

    this.eventsGateway.broadcastDataChange('gps:position-update', {
      carId: car._id,
      matricule: car.matricule,
      brand: car.brand,
      model: car.model,
      lat: dto.lat,
      lng: dto.lng,
      speed,
      heading: dto.heading ?? 0,
      provider: dto.provider || 'unknown',
      positionAt,
      isRented,
    });

    const limit = await this.getSpeedAlertLimit();
    if (speed >= limit) {
      void this.recordSpeedAlert(car, dto, positionAt);
    }

    return { accepted: true, carId: String(car._id) };
  }

  private async recordSpeedAlert(
    car: CarDocument,
    dto: { lat: number; lng: number; speed?: number; provider?: string },
    positionAt: Date,
  ): Promise<void> {
    try {
      const limit = await this.getSpeedAlertLimit();
      const lastAlert = await this.speedAlertModel
        .findOne({ carId: car._id })
        .sort({ alertAt: -1 })
        .exec();

      if (
        lastAlert &&
        positionAt.getTime() - new Date(lastAlert.alertAt).getTime() <
          SPEED_ALERT_COOLDOWN_MS
      ) {
        return;
      }

      const alert = await this.speedAlertModel.create({
        carId: car._id,
        matricule: car.matricule || '',
        brand: car.brand || '',
        model: car.model || '',
        speed: dto.speed ?? 0,
        limit,
        lat: dto.lat,
        lng: dto.lng,
        provider: dto.provider || '',
        alertAt: positionAt,
      });

      this.logger.warn(
        `SPEED ALERT: ${car.brand} ${car.model} (${car.matricule}) at ${dto.speed} km/h (limit ${limit})`,
      );

      this.eventsGateway.broadcastDataChange('gps:speed-alert', {
        _id: String(alert._id),
        carId: String(car._id),
        matricule: car.matricule || '',
        brand: car.brand || '',
        model: car.model || '',
        speed: dto.speed ?? 0,
        limit,
        lat: dto.lat,
        lng: dto.lng,
        provider: dto.provider || '',
        alertAt: positionAt.toISOString(),
      });
    } catch (err) {
      this.logger.error(`Failed to record speed alert: ${String(err)}`);
    }
  }

  async getSpeedAlerts(limit = 50): Promise<SpeedAlertDocument[]> {
    return this.speedAlertModel
      .find()
      .sort({ alertAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .exec();
  }

  /** Manually trigger a test speed alert to verify the notification pipeline */
  async testSpeedAlert(carId: string): Promise<{ sent: boolean; message: string }> {
    const car = await this.carModel.findById(carId).exec();
    if (!car) return { sent: false, message: 'Voiture introuvable' };

    const limit = await this.getSpeedAlertLimit();
    const fakeSpeed = limit + 30;
    const now = new Date();

    const alert = await this.speedAlertModel.create({
      carId: car._id,
      matricule: car.matricule || '',
      brand: car.brand || '',
      model: car.model || '',
      speed: fakeSpeed,
      lat: 36.8065,
      lng: 10.1815,
      provider: 'test',
      alertAt: now,
    });

    this.logger.warn(
      `TEST SPEED ALERT: ${car.brand} ${car.model} (${car.matricule}) at ${fakeSpeed} km/h (limit ${limit})`,
    );

    this.eventsGateway.broadcastDataChange('gps:speed-alert', {
      _id: String(alert._id),
      carId: String(car._id),
      matricule: car.matricule || '',
      brand: car.brand || '',
      model: car.model || '',
      speed: fakeSpeed,
      limit,
      lat: 36.8065,
      lng: 10.1815,
      provider: 'test',
      alertAt: now.toISOString(),
    });

    return { sent: true, message: `Alerte test envoyée: ${car.brand} ${car.model} à ${fakeSpeed} km/h` };
  }

  async deleteSpeedAlert(id: string): Promise<{ deleted: boolean }> {
    const result = await this.speedAlertModel.findByIdAndDelete(id).exec();
    return { deleted: !!result };
  }

  async exportToCloudinary(
    contractId: string,
    carId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ url: string | null; count: number }> {
    return { url: null, count: 0 };
  }

  /** Km traveled today per car (Tunisia local day) */
  async getKmToday(): Promise<{
    day: string;
    limit: number;
    cars: any[];
  }> {
    const day = tunisiaDayKey(new Date());
    return {
      day,
      limit: 0,
      cars: [],
    };
  }

  async getPositions() {
    const positions = await this.carPositionModel
      .find()
      .populate('carId', 'matricule brand model color isAvailable')
      .exec();

    const carIds = positions
      .map((p: any) => p.carId?._id)
      .filter((id: any) => id);
    const activeByCar = new Map<string, any>();
    if (carIds.length > 0) {
      const now = new Date();
      // `car` can be stored as ObjectId OR as plain string in existing data,
      // so match both variants.
      const idVariants = [...carIds, ...carIds.map(String)];
      const contrats = await this.contratModel
        .find({
          status: { $in: ['active', 'soon'] },
          startDate: { $lte: now },
          endDate: { $gte: now },
          car: { $in: idVariants },
        })
        .sort({ startDate: -1 })
        .populate({
          path: 'clients',
          model: 'Client',
          select:
            '_id firstName lastName phone phoneCountryCode cin email address',
        })
        .exec();
      for (const c of contrats) {
        const key = String((c as any).car);
        if (!activeByCar.has(key)) {
          activeByCar.set(key, {
            _id: String(c._id),
            reference: c.reference,
            startDate: c.startDate,
            endDate: c.endDate,
            totalAmount: c.totalAmount,
            depositAmount: c.depositAmount,
            carDailyRate: c.carDailyRate,
            paymentMethod: c.paymentMethod,
            lieuDepart: c.lieuDepart,
            lieuRetour: c.lieuRetour,
            isPaid: c.isPaid,
            clients: ((c.clients as any[]) || []).map((cl) => ({
              _id: cl?._id ? String(cl._id) : undefined,
              firstName: cl.firstName,
              lastName: cl.lastName,
              phone: cl.phone,
              phoneCountryCode: cl.phoneCountryCode,
              cin: cl.cin,
              email: cl.email,
              address: cl.address,
            })),
          });
        }
      }
    }

    return positions
      .filter((p) => p.carId)
      .map((p: any) => ({
        _id: p._id,
        carId: p.carId?._id ?? p.carId,
        matricule: p.carId?.matricule ?? '',
        brand: p.carId?.brand ?? '',
        model: p.carId?.model ?? '',
        carColor: p.carId?.color ?? '',
        isAvailable: p.carId?.isAvailable ?? true,
        rental: activeByCar.get(String(p.carId?._id)) ?? null,
        lat: p.lat,
        lng: p.lng,
        speed: p.speed,
        provider: p.provider,
        imei: p.imei,
        positionAt: p.positionAt,
      }))
      .sort((a, b) => a.matricule.localeCompare(b.matricule));
  }
}
