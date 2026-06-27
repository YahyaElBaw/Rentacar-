import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ReservationService } from './reservation.service';

@Controller('reservations')
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

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

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: any) {
    return this.reservationService.update(id, updateDto);
  }

  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.reservationService.cancel(id);
  }
}
