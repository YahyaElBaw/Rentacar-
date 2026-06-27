import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request, UnauthorizedException, Res } from '@nestjs/common';
import { Response } from 'express';
import { ClientService } from './client.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Controller('clients')
export class ClientController {
  constructor(
    private readonly clientService: ClientService,
    private readonly usersService: UsersService
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() createClientDto: any, @Request() req: any) {
    return this.clientService.create(createClientDto, req.user.id);
  }

  @Get()
  findAll(@Query('search') search?: string, @Query('disabled') disabled?: string) {
    return this.clientService.findAll(search, disabled);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clientService.findOne(id);
  }

  @Get(':id/pdf')
  @UseGuards(JwtAuthGuard)
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.clientService.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=client-${id}.pdf`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() updateData: any, @Request() req: any) {
    const { password, ...updateClientDto } = updateData;
    
    if (password) {
      const user = await this.usersService.findById(req.user.id);
      if (!user) throw new UnauthorizedException('User not found');
      
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) throw new UnauthorizedException('Invalid admin password');
    }

    return this.clientService.update(id, updateClientDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Body('password') password: string, @Request() req: any) {
    if (!password) {
      throw new UnauthorizedException('Admin password is required to disable a client');
    }

    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid password');
    }

    return this.clientService.remove(id);
  }
}
