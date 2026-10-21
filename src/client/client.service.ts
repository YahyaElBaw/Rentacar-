import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client } from './schemas/client.schema';
import { PdfService } from '../shared/pdf.service';

@Injectable()
export class ClientService implements OnModuleInit {
  constructor(
    @InjectModel(Client.name) private clientModel: Model<Client>,
    private readonly pdfService: PdfService,
  ) {}

  async onModuleInit() {
    try {
      await this.clientModel
        .updateMany(
          { lieuNaissance: { $exists: false } },
          { $set: { lieuNaissance: '' } },
        )
        .exec();
      await this.clientModel
        .updateMany(
          { lieuPermis: { $exists: false } },
          { $set: { lieuPermis: '' } },
        )
        .exec();
      await this.clientModel
        .updateMany(
          { nationality: { $exists: false } },
          { $set: { nationality: '' } },
        )
        .exec();

      const collection = this.clientModel.collection;
      for (const field of ['cin', 'drivingLicense']) {
        try {
          const indexes = await collection.indexes();
          const legacy = indexes.find(
            (i) => i.name === `${field}_1` && !i.sparse,
          );
          if (legacy) {
            await collection.dropIndex(`${field}_1`);
          }
          await collection.createIndex({ [field]: 1 }, { unique: true, sparse: true });
        } catch (idxErr) {
          console.error(`Error migrating ${field} index:`, idxErr);
        }
      }
    } catch (err) {
      console.error('Error auto-migrating client fields on module init:', err);
    }
  }

  private sanitizeClientDto(dto: any): any {
    const sanitized = { ...dto };
    ['birthday', 'cinDate', 'licenseDate'].forEach((dateKey) => {
      if (sanitized[dateKey] === '' || sanitized[dateKey] === null) {
        delete sanitized[dateKey];
      }
    });
    ['cin', 'drivingLicense'].forEach((key) => {
      if (
        sanitized[key] === undefined ||
        sanitized[key] === null ||
        String(sanitized[key]).trim() === ''
      ) {
        delete sanitized[key];
      } else {
        sanitized[key] = String(sanitized[key]).trim();
      }
    });
    ['cinFront', 'cinBack', 'licenseFront', 'licenseBack'].forEach((key) => {
      if (
        sanitized[key] === undefined ||
        sanitized[key] === null ||
        String(sanitized[key]).trim() === ''
      ) {
        delete sanitized[key];
      } else {
        sanitized[key] = String(sanitized[key]).trim();
      }
    });
    delete sanitized.source;
    if (
      sanitized.lieuNaissance !== undefined &&
      sanitized.lieuNaissance !== null
    ) {
      sanitized.lieuNaissance = String(sanitized.lieuNaissance).trim();
    }
    if (sanitized.lieuPermis !== undefined && sanitized.lieuPermis !== null) {
      sanitized.lieuPermis = String(sanitized.lieuPermis).trim();
    }
    if (sanitized.nationality !== undefined && sanitized.nationality !== null) {
      sanitized.nationality = String(sanitized.nationality).trim();
    }
    return sanitized;
  }

  private processDocumentFields(dto: any, actor?: any, isUpdate = false): void {
    const isSuperAdmin = actor?.role === 'super_admin';
    if (isSuperAdmin) {
      // Super admin can save client without docs!
      return;
    }

    // For other users creating via standard client form:
    if (!isUpdate && dto.source !== 'availability') {
      const hasCinDocs = dto.idCardType === 'passport'
        ? !!(dto.cinFront && String(dto.cinFront).trim())
        : !!(dto.cinFront && String(dto.cinFront).trim() && dto.cinBack && String(dto.cinBack).trim());
      const hasLicenseDocs = !!(
        dto.licenseFront &&
        String(dto.licenseFront).trim() &&
        dto.licenseBack &&
        String(dto.licenseBack).trim()
      );

      if (!dto.cin?.trim() || !dto.drivingLicense?.trim() || !hasCinDocs || !hasLicenseDocs) {
        throw new BadRequestException(
          'Les pièces d\'identité et documents scannés sont obligatoires pour enregistrer le client.',
        );
      }
    }
  }

  private processPhoneFields(dto: any, actor?: any, isUpdate = false): void {
    const isSuperAdmin = actor?.role === 'super_admin';
    const hasPhone = dto.phone !== undefined;
    const hasCode = dto.phoneCountryCode !== undefined;

    if (!isUpdate || hasPhone || hasCode) {
      const rawPhone = hasPhone && dto.phone !== null ? String(dto.phone).trim() : '';
      const rawCode = hasCode && dto.phoneCountryCode !== null ? String(dto.phoneCountryCode).trim() : '';

      const isDummyEmpty =
        rawCode === '000' ||
        rawCode === '+000' ||
        rawPhone === '00000000';

      if (isSuperAdmin) {
        // Super Admin: (000) and (00000000) or blank phone means empty phone
        if (isDummyEmpty || (!rawPhone && !rawCode)) {
          dto.phone = '';
          dto.phoneCountryCode = '';
        }
      } else {
        // Other users: phone is strictly mandatory and dummy shortcuts are prohibited
        if (isDummyEmpty) {
          throw new BadRequestException('Le numéro de téléphone est obligatoire.');
        }
        if (!isUpdate && !rawPhone) {
          throw new BadRequestException('Le numéro de téléphone est obligatoire.');
        }
        if (isUpdate && hasPhone && !rawPhone) {
          throw new BadRequestException('Le numéro de téléphone est obligatoire.');
        }
      }
    }
  }

  async create(createClientDto: any, actor?: any): Promise<Client> {
    try {
      this.processPhoneFields(createClientDto, actor, false);
      this.processDocumentFields(createClientDto, actor, false);
      const sanitizedDto = this.sanitizeClientDto(createClientDto);
      const userId = typeof actor === 'object' && actor?.id ? actor.id : actor;
      const createdClient = new this.clientModel({
        lieuNaissance: '',
        lieuPermis: '',
        nationality: '',
        ...sanitizedDto,
        addedBy: userId,
      });
      return await createdClient.save();
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException('CIN or Driving License already exists');
      }
      throw error;
    }
  }

  async findAll(search?: string, disabled?: string): Promise<Client[]> {
    const showDisabled = disabled === 'true';
    const baseQuery: any = showDisabled
      ? { disabled: true }
      : { disabled: { $ne: true } };

    if (search && search.trim() !== '') {
      const searchTerms = search.trim().split(/\s+/);
      const andConditions = searchTerms.map((term) => ({
        $or: [
          { firstName: { $regex: term, $options: 'i' } },
          { lastName: { $regex: term, $options: 'i' } },
          { cin: { $regex: term, $options: 'i' } },
          { phone: { $regex: term, $options: 'i' } },
        ],
      }));

      return this.clientModel
        .find({ ...baseQuery, $and: andConditions })
        .select('-cinFront -cinBack -licenseFront -licenseBack')
        .populate('addedBy', 'firstName lastName')
        .sort({ totalRents: -1, lastName: 1 })
        .lean()
        .exec() as any;
    }
    return this.clientModel
      .find(baseQuery)
      .select('-cinFront -cinBack -licenseFront -licenseBack')
      .populate('addedBy', 'firstName lastName')
      .sort({ totalRents: -1, lastName: 1 })
      .lean()
      .exec() as any;
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.clientModel
      .findById(id)
      .populate('addedBy', 'firstName lastName')
      .exec();
    if (!client) throw new NotFoundException(`Client with ID ${id} not found`);
    return client;
  }

  async update(id: string, updateClientDto: any, actor?: any): Promise<Client> {
    this.processPhoneFields(updateClientDto, actor, true);
    this.processDocumentFields(updateClientDto, actor, true);
    const sanitizedDto = this.sanitizeClientDto(updateClientDto);
    console.log(
      `[ClientService] Updating client ${id} with:`,
      JSON.stringify(sanitizedDto, null, 2),
    );
    const updatedClient = await this.clientModel
      .findByIdAndUpdate(
        id,
        { $set: sanitizedDto },
        { new: true, runValidators: false },
      )
      .populate('addedBy', 'firstName lastName')
      .exec();
    if (!updatedClient) {
      console.error(`[ClientService] Client ${id} NOT FOUND for update`);
      throw new NotFoundException(`Client with ID ${id} not found`);
    }
    console.log(`[ClientService] Client ${id} updated successfully`);
    return updatedClient;
  }
  async remove(id: string): Promise<any> {
    const result = await this.clientModel
      .findByIdAndUpdate(id, { disabled: true }, { new: true })
      .exec();
    if (!result) throw new NotFoundException(`Client with ID ${id} not found`);
    return result;
  }

  async generatePdf(id: string): Promise<Buffer> {
    const client = await this.findOne(id);
    return this.pdfService.generateClientPDF(client);
  }
}
