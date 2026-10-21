import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { AgenceService } from './agence.service';
import { Agence } from './schemas/agence.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Controller('agences')
export class AgenceController {
  constructor(
    private readonly agenceService: AgenceService,
    private readonly usersService: UsersService,
  ) {}

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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Body('password') password: string,
    @Req() req: any,
  ) {
    if (!password) {
      throw new UnauthorizedException(
        'Super admin password is required to delete an agence',
      );
    }

    const user = await this.usersService.findById(req.user.id);
    if (!user) throw new UnauthorizedException('User not found');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new BadRequestException('Invalid password');

    return this.agenceService.remove(id);
  }
}
