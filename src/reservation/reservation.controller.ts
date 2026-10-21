import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReservationService } from './reservation.service';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Controller('reservations')
export class ReservationController {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  create(@Body() createReservationDto: any) {
    return this.reservationService.create(createReservationDto);
  }

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('carId') carId?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.reservationService.findAll({ status, carId, clientId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reservationService.findOne(id);
  }

  @Patch(':id/confirm')
  confirm(@Param('id') id: string, @Query('force') force?: string) {
    return this.reservationService.confirm(id, force === 'true');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; contratId?: string },
  ) {
    return this.reservationService.updateStatus(id, body.status, body.contratId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: any,
    @Req() req: any,
  ) {
    const user = await this.usersService.findById(req.user.id);

    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      throw new ForbiddenException('Only administrators can edit reservations');
    }

    const { password, ...reservationData } = updateDto;

    if (!password) {
      throw new UnauthorizedException(
        'Password is required to edit a reservation',
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new BadRequestException('Invalid password');
    }

    return this.reservationService.update(id, reservationData);
  }

  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.reservationService.cancel(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Delete(':id/force')
  async forceDelete(
    @Param('id') id: string,
    @Body() body: { password?: string },
    @Req() req: any,
  ) {
    const user = await this.usersService.findById(req.user.id);

    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      throw new ForbiddenException('Only administrators can delete reservations');
    }

    if (!body?.password) {
      throw new BadRequestException(
        'Password is required to delete a reservation',
      );
    }

    const isMatch = await bcrypt.compare(body.password, user.password);
    if (!isMatch) {
      throw new BadRequestException('Invalid password');
    }

    return this.reservationService.forceDelete(id);
  }
}
