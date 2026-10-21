import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Res,
  UseGuards,
  Req,
  Delete,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
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
  async create(@Body() createContratDto: any, @Req() req: any) {
    if (createContratDto.force) {
      const user = await this.usersService.findById(req.user.id);
      if (!user || user.role !== 'super_admin') {
        throw new ForbiddenException(
          'Seul un super administrateur peut forcer la création d’un contrat',
        );
      }
    }
    return this.contratService.create(createContratDto, req.user);
  }

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('reference') reference?: string,
    @Query('carId') carId?: string,
    @Query('clientId') clientId?: string,
    @Query('summary') summary?: string,
  ) {
    return this.contratService.findAll({ status, reference, carId, clientId, summary });
  }

  @UseGuards(JwtAuthGuard)
  @Get('deleted')
  findDeleted() {
    return this.contratService.findDeleted();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contratService.findOne(id, true);
  }

  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    try {
      const contrat = await this.contratService.findOne(id);
      const buffer = await this.pdfService.generateContractPDF(contrat);

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=contrat-${contrat.reference}.pdf`,
        'Content-Length': buffer.length,
      });

      res.end(buffer);
    } catch (err) {
      console.error('PDF generation failed:', err);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ message: 'Erreur lors de la génération du PDF' });
      }
    }
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/close')
  close(@Param('id') id: string, @Body() closureData: any, @Req() req: any) {
    return this.contratService.close(id, closureData, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.contratService.cancel(id, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateData: any,
    @Req() req: any,
  ) {
    const userId = req.user.id;
    const user = await this.usersService.findById(userId);

    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      throw new ForbiddenException('Only administrators can edit contracts');
    }

    const { password, ...contratData } = updateData;

    if (!password) {
      throw new UnauthorizedException(
        'Password is required to edit a contract',
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new BadRequestException('Invalid password');
    }

    const actor = {
      id: user._id.toString(),
      cin: user.cin,
      role: user.role,
      name: `${user.firstName} ${user.lastName}`,
    };

    // Only super_admin can alter contract reference number
    if (
      (contratData.reference !== undefined || contratData.contractNumber !== undefined) &&
      user.role !== 'super_admin'
    ) {
      delete contratData.reference;
      delete contratData.contractNumber;
    }

    return this.contratService.update(id, contratData, actor);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Body('password') password: string,
    @Req() req: any,
  ) {
    const userId = req.user.id;
    const user = await this.usersService.findById(userId);

    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      throw new ForbiddenException('Only administrators can delete contracts');
    }

    // Password optional for soft delete (moving to trash)
    if (password) {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        throw new BadRequestException('Invalid password');
      }
    }

    const actor = {
      id: user._id.toString(),
      cin: user.cin,
      role: user.role,
      name: `${user.firstName} ${user.lastName}`,
    };

    return this.contratService.remove(id, actor);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/restore')
  async restore(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.id;
    const user = await this.usersService.findById(userId);

    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      throw new ForbiddenException('Only administrators can restore contracts');
    }

    const actor = {
      id: user._id.toString(),
      cin: user.cin,
      role: user.role,
      name: `${user.firstName} ${user.lastName}`,
    };

    return this.contratService.restore(id, actor);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/permanent')
  async permanentDelete(
    @Param('id') id: string,
    @Body('password') password: string,
    @Req() req: any,
  ) {
    const userId = req.user.id;
    const user = await this.usersService.findById(userId);

    if (!user || user.role !== 'super_admin') {
      throw new ForbiddenException('Only super administrators can permanently delete contracts');
    }

    if (!password) {
      throw new BadRequestException(
        'Password is required to permanently delete a contract',
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new BadRequestException('Invalid password');
    }

    const actor = {
      id: user._id.toString(),
      cin: user.cin,
      role: user.role,
      name: `${user.firstName} ${user.lastName}`,
    };

    return this.contratService.permanentDelete(id, actor);
  }
}
