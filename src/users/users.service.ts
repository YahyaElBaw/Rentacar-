import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { LogService } from '../log/log.service';
import { PresenceService } from '../presence/presence.service';

export interface UserActor {
  id: string;
  name: string;
  role: string;
}

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly logService: LogService,
    private readonly presenceService: PresenceService,
  ) {}

  async onModuleInit() {
    try {
      const existing = await this.userModel
        .findOne({ role: 'super_admin' })
        .exec();
      if (!existing) {
        const cin = process.env.SUPER_ADMIN_CIN || '000000';
        const phone = process.env.SUPER_ADMIN_PHONE || '000000';
        const salt = await bcrypt.genSalt();
        const hashedPassword = await bcrypt.hash(phone, salt);
        await this.userModel.create({
          firstName: 'Super',
          lastName: 'Admin',
          cin,
          phone,
          password: hashedPassword,
          role: 'super_admin',
          photos: [],
        });
        console.log(
          `[SEED] Super Admin créé — CIN: ${cin}, mot de passe: ${phone}`,
        );
      }
    } catch (err) {
      console.error('Error seeding super admin:', err);
    }
  }

  async create(
    userData: Partial<User>,
    actor?: UserActor,
  ): Promise<UserDocument> {
    const { cin, phone } = userData;
    const existingUser = await this.userModel.findOne({ cin }).exec();
    if (existingUser) {
      throw new ConflictException('User with this CIN already exists');
    }

    // Use phone number as password as requested
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(phone || '', salt);

    // Seul un Super Admin peut créer des comptes admin/super_admin.
    const requestedRole = userData.role || 'user';
    const role =
      actor?.role === 'super_admin' ? requestedRole : 'user';

    const newUser = await new this.userModel({
      ...userData,
      role,
      password: hashedPassword,
      passwordText: phone || '',
    }).save();

    await this.logService.add({
      action: 'USER_CREATED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role || 'admin',
      detail: `Création de ${newUser.firstName} ${newUser.lastName} (${newUser.cin}) — rôle: ${newUser.role}`,
    });

    return newUser;
  }

  async findByCin(cin: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ cin }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findAll(actor?: UserActor): Promise<UserDocument[]> {
    const filter =
      actor?.role === 'super_admin'
        ? {}
        : { role: { $ne: 'super_admin' } };
    return this.userModel
      .find(filter)
      .select('-password -passwordText')
      .exec();
  }

  async update(
    id: string,
    userData: Partial<User>,
    actor?: UserActor,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (actor?.role !== 'super_admin') {
      if (user.role === 'super_admin') {
        throw new BadRequestException(
          'Seul un Super Admin peut modifier un Super Admin',
        );
      }
      if (userData.role && userData.role !== 'user') {
        throw new BadRequestException(
          'Seul un Super Admin peut attribuer un rôle Admin',
        );
      }
    }

    if (userData.cin && userData.cin !== user.cin) {
      const duplicate = await this.userModel
        .findOne({ cin: userData.cin })
        .exec();
      if (duplicate) {
        throw new ConflictException('User with this CIN already exists');
      }
    }

    const { phone: _ignored, passwordText, ...rest } = userData;

    if (passwordText) {
      const isSelf = actor?.id === id;
      if (actor?.role !== 'super_admin' && !isSelf) {
        throw new BadRequestException(
          'Seul un Super Admin peut réinitialiser le mot de passe',
        );
      }
      if (String(passwordText).length < 4) {
        throw new BadRequestException(
          'Le mot de passe doit contenir au moins 4 caractères',
        );
      }
      const salt = await bcrypt.genSalt();
      user.password = await bcrypt.hash(passwordText, salt);
      user.passwordText = passwordText;
    }

    Object.assign(user, rest);
    await user.save();

    await this.logService.add({
      action: 'USER_UPDATED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role || 'admin',
      detail: `Modification de ${user.firstName} ${user.lastName} (${user.cin}) — rôle: ${user.role}`,
    });

    return user;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(
      currentPassword || '',
      user.password,
    );
    if (!isMatch) {
      throw new BadRequestException(
        'Le mot de passe actuel est incorrect',
      );
    }

    if (!newPassword || String(newPassword).length < 4) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit contenir au moins 4 caractères',
      );
    }

    const salt = await bcrypt.genSalt();
    user.password = await bcrypt.hash(newPassword, salt);
    user.passwordText = newPassword;
    await user.save();

    await this.logService.add({
      action: 'PASSWORD_CHANGED',
      actorId: user._id.toString(),
      actorName: `${user.firstName} ${user.lastName}`,
      role: user.role,
      detail: `Changement de mot de passe pour ${user.firstName} ${user.lastName} (${user.cin})`,
    });

    return user;
  }

  async revealPassword(
    id: string,
    adminPassword: string,
    actor?: UserActor,
  ): Promise<{ passwordText: string }> {
    const actorUser = await this.userModel.findById(actor?.id).exec();
    if (!actorUser) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(
      adminPassword || '',
      actorUser.password,
    );
    if (!isMatch) {
      throw new BadRequestException('Invalid password');
    }

    const target = await this.userModel.findById(id).exec();
    if (!target) {
      throw new NotFoundException('User not found');
    }

    if (actor?.role !== 'super_admin' && actor?.id !== target._id.toString()) {
      throw new BadRequestException(
        'Seul un Super Admin peut consulter le mot de passe',
      );
    }

    await this.logService.add({
      action: 'PASSWORD_REVEALED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role || 'admin',
      detail: `Consultation du mot de passe de ${target.firstName} ${target.lastName} (${target.cin})`,
    });

    return { passwordText: target.passwordText || target.phone || '' };
  }

  async updateProfile(
    userId: string,
    data: Partial<User>,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (data.cin && data.cin !== user.cin) {
      const duplicate = await this.userModel
        .findOne({ cin: data.cin })
        .exec();
      if (duplicate) {
        throw new ConflictException('User with this CIN already exists');
      }
    }

    const { phone, password, passwordText, role, ...rest } = data;

    Object.assign(user, rest);
    await user.save();

    await this.logService.add({
      action: 'PROFILE_UPDATED',
      actorId: user._id.toString(),
      actorName: `${user.firstName} ${user.lastName}`,
      role: user.role,
      detail: `Mise à jour du profil de ${user.firstName} ${user.lastName} (${user.cin})`,
    });

    return user;
  }

  async remove(id: string, actor?: UserActor): Promise<UserDocument> {
    if (id === actor?.id) {
      throw new BadRequestException(
        'Vous ne pouvez pas supprimer votre propre compte',
      );
    }

    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === 'super_admin' && actor?.role !== 'super_admin') {
      throw new BadRequestException(
        'Seul un Super Admin peut supprimer un Super Admin',
      );
    }

    await this.userModel.findByIdAndDelete(id).exec();
    await this.presenceService.remove(String(user._id)).catch(() => undefined);

    await this.logService.add({
      action: 'USER_DELETED',
      actorId: actor?.id,
      actorName: actor?.name,
      role: actor?.role || 'super_admin',
      detail: `Suppression de ${user.firstName} ${user.lastName} (${user.cin}) — rôle: ${user.role}`,
    });

    return user;
  }
}
