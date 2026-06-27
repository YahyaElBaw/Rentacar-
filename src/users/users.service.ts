import { Injectable, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(userData: Partial<User>): Promise<UserDocument> {
    const { cin, phone } = userData;
    const existingUser = await this.userModel.findOne({ cin }).exec();
    if (existingUser) {
      throw new ConflictException('User with this CIN already exists');
    }

    // Use phone number as password as requested
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(phone || '', salt);

    const newUser = new this.userModel({
      ...userData,
      password: hashedPassword,
    });
    return newUser.save();
  }

  async findByCin(cin: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ cin }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }
}
