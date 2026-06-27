import { Controller, Get, Delete, Param, UseGuards, Res, Body, Req, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JourneeService } from './journee.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Controller('journees')
@UseGuards(JwtAuthGuard)
export class JourneeController {
  constructor(
    private readonly journeeService: JourneeService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async findAll() {
    const journees = await this.journeeService.findAll();
    return journees;
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Delete(':id')
  async remove(@Param('id') id: string, @Body('password') password: string, @Req() req: any) {
    const userId = req.user.id;
    const user = await this.usersService.findById(userId);

    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Only administrators can delete a journee');
    }

    if (!password) {
      throw new UnauthorizedException('Password is required to delete a journee');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid password');
    }

    return this.journeeService.remove(id);
  }
}
