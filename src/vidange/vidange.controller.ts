import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { VidangeService } from './vidange.service';

@Controller('vidanges')
export class VidangeController {
  constructor(private readonly vidangeService: VidangeService) {}

  @Post()
  create(@Body() createVidangeDto: any) {
    return this.vidangeService.create(createVidangeDto);
  }

  @Get()
  findAll(@Query('carId') carId?: string) {
    return this.vidangeService.findAll(carId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vidangeService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.vidangeService.remove(id);
  }
}
