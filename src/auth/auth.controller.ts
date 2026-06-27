import { Controller, Post, Body, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: { cin: string; phone: string }) {
    if (!loginDto.cin || !loginDto.phone) {
      throw new UnauthorizedException('Please provide CIN and phone');
    }
    return this.authService.login(loginDto.cin, loginDto.phone);
  }
}
