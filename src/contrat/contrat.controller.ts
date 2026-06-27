import { Controller, Get, Post, Body, Patch, Param, Query, Res, UseGuards, Req, Delete, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ContratService } from './contrat.service';
import { PdfService } from '../shared/pdf.service';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Controller('contrats')
export class ContratController {
  constructor(
    private readonly contratService: ContratService,
    private readonly pdfService: PdfService,
    private readonly usersService: UsersService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() createContratDto: any, @Req() req: any) {
    return this.contratService.create(createContratDto, req.user.id);
  }

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('reference') reference?: string,
    @Query('carId') carId?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.contratService.findAll({ status, reference, carId, clientId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contratService.findOne(id);
  }

  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    const contrat = await this.contratService.findOne(id);
    const buffer = await this.pdfService.generateContractPDF(contrat);
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=contrat-${contrat.reference}.pdf`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Patch(':id/close')
  close(@Param('id') id: string, @Body() closureData: any) {
    return this.contratService.close(id, closureData);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.contratService.cancel(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateData: any, @Req() req: any) {
    const userId = req.user.id;
    const user = await this.usersService.findById(userId);
    
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Only administrators can edit contracts');
    }

    const { password, ...contratData } = updateData;

    if (!password) {
      throw new UnauthorizedException('Password is required to edit a contract');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid password');
    }

    return this.contratService.update(id, contratData);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string, @Body('password') password: string, @Req() req: any) {
    const userId = req.user.id;
    const user = await this.usersService.findById(userId);
    
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Only administrators can delete contracts');
    }

    if (!password) {
      throw new UnauthorizedException('Password is required to delete a contract');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid password');
    }

    return this.contratService.remove(id);
  }
}
