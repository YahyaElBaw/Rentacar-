import { Controller, Get, Post, Body, Param, Delete, Query, Patch } from '@nestjs/common';
import { DepenseService } from './depense.service';

@Controller('depenses')
export class DepenseController {
  constructor(private readonly depenseService: DepenseService) {}

  @Post()
  create(@Body() createDepenseDto: any) {
    return this.depenseService.create(createDepenseDto);
  }

  @Get()
  findAll(@Query('carId') carId?: string) {
    return this.depenseService.findAll(carId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.depenseService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDepenseDto: any) {
    return this.depenseService.update(id, updateDepenseDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.depenseService.remove(id);
  }
}
