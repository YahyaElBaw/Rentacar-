import {
  Controller,
  Get,
  Post,
  Body,
  Delete,
  Patch,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { UsersService, UserActor } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  private toActor(user: any): UserActor {
    return {
      id: user?.id,
      name: user?.name || user?.cin || '',
      role: user?.role || '',
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post()
  async create(@Body() userData: any, @Req() req: any) {
    return this.usersService.create(userData, this.toActor(req.user));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get()
  async findAll(@Req() req: any) {
    return this.usersService.findAll(this.toActor(req.user));
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@Req() req: any, @Body() userData: any) {
    return this.usersService.updateProfile(req.user.id, userData);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() userData: any,
    @Req() req: any,
  ) {
    return this.usersService.update(id, userData, this.toActor(req.user));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.usersService.remove(id, this.toActor(req.user));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post(':id/reveal-password')
  async revealPassword(
    @Param('id') id: string,
    @Body('password') password: string,
    @Req() req: any,
  ) {
    return this.usersService.revealPassword(
      id,
      password,
      this.toActor(req.user),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Req() req: any) {
    return this.usersService.findById(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@Req() req: any, @Body() body: any) {
    return this.usersService.changePassword(
      req.user.id,
      body?.currentPassword,
      body?.newPassword,
    );
  }
}
