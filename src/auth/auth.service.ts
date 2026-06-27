import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async login(cin: string, phone: string) {
    console.log(`Login attempt for CIN: ${cin}`);
    const user = await this.usersService.findByCin(cin);
    if (!user) {
      console.log(`User not found for CIN: ${cin}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(phone, user.password);
    if (!isMatch) {
      console.log(`Password mismatch for CIN: ${cin}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    console.log(`Login successful for CIN: ${cin}`);
    const payload = { sub: user._id, cin: user.cin, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }
}
