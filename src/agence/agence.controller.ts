import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { AgenceService } from './agence.service';
import { Agence } from './schemas/agence.schema';

@Controller('agences')
export class AgenceController {
  constructor(private readonly agenceService: AgenceService) {}

  @Get()
  findAll() {
    return this.agenceService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.agenceService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<Agence>) {
    return this.agenceService.create(data);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: Partial<Agence>) {
    return this.agenceService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.agenceService.remove(id);
  }
}
