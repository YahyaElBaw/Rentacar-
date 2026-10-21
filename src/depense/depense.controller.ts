import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  Patch,
  UseGuards,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { DepenseService } from './depense.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Controller('depenses')
export class DepenseController {
  constructor(
    private readonly depenseService: DepenseService,
    private readonly usersService: UsersService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() createDepenseDto: any, @Req() req: any) {
    return this.depenseService.create(createDepenseDto, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('bulk')
  createMany(@Body() createDepenseDtos: any[], @Req() req: any) {
    return this.depenseService.createMany(createDepenseDtos, req.user);
  }

  @Get()
  findAll(@Query('carId') carId?: string) {
    return this.depenseService.findAll(carId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.depenseService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDepenseDto: any,
    @Req() req: any,
  ) {
    const user = await this.usersService.findById(req.user.id);
    if (user && user.role === 'super_admin') {
      const { password, ...data } = updateDepenseDto || {};
      if (!password) {
        throw new UnauthorizedException(
          'Password is required to edit a depense',
        );
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        throw new BadRequestException('Invalid password');
      }
      return this.depenseService.update(id, data);
    }
    return this.depenseService.update(id, updateDepenseDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.depenseService.remove(id, req.user);
  }
}
