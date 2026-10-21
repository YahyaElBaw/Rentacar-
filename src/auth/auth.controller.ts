import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: { cin: string; phone: string }, @Req() req: any) {
    if (!loginDto.cin || !loginDto.phone) {
      throw new UnauthorizedException('Please provide CIN and phone');
    }
    const ua: string = req?.headers?.['user-agent'] || '';
    const device = /okhttp|ReactNative|Expo|dart:io|Android|iPhone|iPad|Mobile/i.test(ua)
      ? 'phone'
      : 'pc';
    return this.authService.login(loginDto.cin, loginDto.phone, device);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: any) {
    const ua: string = req?.headers?.['user-agent'] || '';
    const device = /okhttp|ReactNative|Expo|dart:io|Android|iPhone|iPad|Mobile/i.test(ua)
      ? 'phone'
      : 'pc';
    await this.authService.logout(req.user, device);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify-password')
  async verifyPassword(@Req() req: any, @Body() body: { password: string }) {
    return this.authService.verifyPassword(req.user, body?.password);
  }
}
