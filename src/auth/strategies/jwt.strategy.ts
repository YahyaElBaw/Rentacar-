import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'secretKey',
    });
  }

  async validate(payload: any) {
    console.log('Validating JWT payload:', payload);
    const cin = payload.cin?.trim();
    const user = await this.usersService.findByCin(cin);
    if (!user) {
      console.log(`User not found in DB for CIN: "${cin}"`);
      throw new UnauthorizedException();
    }
    console.log(`User validated successfully: ${user.cin} (${user.role})`);
    return {
      id: user._id,
      cin: user.cin,
      role: user.role,
      name: `${user.firstName} ${user.lastName}`,
    };
  }
}
