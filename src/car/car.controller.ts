import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { CarService } from './car.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Controller('cars')
export class CarController {
  constructor(
    private readonly carService: CarService,
    private readonly usersService: UsersService,
  ) {}

  @Get('available-search')
  findAvailable(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.carService.findAvailable(
      new Date(startDate),
      new Date(endDate),
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post()
  create(@Body() createCarDto: any) {
    return this.carService.create(createCarDto);
  }

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('brand') brand?: string,
    @Query('category') category?: string,
    @Query('available') available?: string,
    @Query('isAvailable') isAvailableLegacy?: string,
    @Query('disabled') disabled?: string,
  ) {
    const availableVal = available || isAvailableLegacy;
    const isAvailable =
      availableVal === 'true'
        ? true
        : availableVal === 'false'
          ? false
          : undefined;
    return this.carService.findAll({
      status,
      brand,
      category,
      isAvailable,
      disabled,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.carService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('isAvailable') isAvailable: boolean,
  ) {
    if (typeof isAvailable !== 'boolean') {
      throw new BadRequestException('isAvailable (boolean) is required');
    }
    return this.carService.update(id, { isAvailable });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateCarDto: any,
    @Req() req: any,
  ) {
    const { password, ...data } = updateCarDto;
    await this.verifyAdminPassword(req, password);
    return this.carService.update(id, data);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post(':id/documents')
  async addDocument(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const { password, ...document } = body;
    await this.verifyAdminPassword(req, password);
    return this.carService.addDocument(id, document);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id/documents/:documentId')
  async removeDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Query('password') password: string,
    @Req() req: any,
  ) {
    await this.verifyAdminPassword(req, password);
    return this.carService.removeDocument(id, documentId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Body('password') password: string,
    @Req() req: any,
  ) {
    await this.verifyAdminPassword(req, password);
    return this.carService.remove(id);
  }

  private async verifyAdminPassword(req: any, password: string) {
    if (!password)
      throw new UnauthorizedException('Admin password is required');
    const user = await this.usersService.findById(req.user.id);
    if (!user) throw new UnauthorizedException('User not found');
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new BadRequestException('Invalid password');
  }
}
