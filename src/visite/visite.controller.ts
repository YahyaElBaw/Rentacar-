import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  Patch,
} from '@nestjs/common';
import { VisiteService } from './visite.service';

@Controller('visites')
export class VisiteController {
  constructor(private readonly visiteService: VisiteService) {}

  @Post()
  create(@Body() createVisiteDto: any) {
    return this.visiteService.create(createVisiteDto);
  }

  @Get()
  findAll(@Query('carId') carId?: string) {
    return this.visiteService.findAll(carId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.visiteService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateVisiteDto: any) {
    return this.visiteService.update(id, updateVisiteDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.visiteService.remove(id);
  }
}
