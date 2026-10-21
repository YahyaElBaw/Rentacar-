import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { LogService } from '../log/log.service';
import { EventsGateway } from '../events/events.gateway';
import { PresenceService } from '../presence/presence.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private logService: LogService,
    private eventsGateway: EventsGateway,
    private presenceService: PresenceService,
  ) {}

  async login(cin: string, phone: string, device?: string) {
    console.log(`Login attempt for CIN: ${cin}`);
    const user = await this.usersService.findByCin(cin);
    if (!user) {
      console.log(`User not found for CIN: ${cin}`);
      await this.logService.add({
        action: 'LOGIN_FAILED',
        actorName: cin,
        role: 'unknown',
        detail: `Tentative de connexion échouée (utilisateur introuvable) pour CIN ${cin}`,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(phone, user.password);
    if (!isMatch) {
      console.log(`Password mismatch for CIN: ${cin}`);
      await this.logService.add({
        action: 'LOGIN_FAILED',
        actorId: user._id.toString(),
        actorName: `${user.firstName} ${user.lastName}`,
        role: user.role,
        detail: `Mot de passe incorrect pour ${user.firstName} ${user.lastName} (${cin})`,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    console.log(`Login successful for CIN: ${cin}`);
    // Record login audit log asynchronously without blocking login response
    this.logService.add({
      action: 'LOGIN',
      actorId: user._id.toString(),
      actorName: `${user.firstName} ${user.lastName}`,
      role: user.role,
      detail: `Connexion réussie pour ${user.firstName} ${user.lastName} (${cin})`,
    }).catch(err => console.error('Background logService error:', err));

    const fullName = `${user.firstName} ${user.lastName}`;
    // Send presence heartbeat and events asynchronously without blocking login response
    this.presenceService.heartbeat(
      user._id.toString(),
      fullName,
      user.role,
      device,
    ).then(() => {
      this.eventsGateway.broadcastOnlineUsers();
    }).catch(err => console.error('Background presenceService error:', err));

    this.eventsGateway.broadcastDataChange('user:login', {
      userId: user._id.toString(),
      name: fullName,
      role: user.role,
    });

    const payload = {
      sub: user._id,
      cin: user.cin,
      role: user.role,
      name: `${user.firstName} ${user.lastName}`,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  async logout(actor: any, device?: string) {
    if (!actor?.id) return;
    const name = actor.name || actor.cin || 'utilisateur';
    await this.logService.add({
      action: 'LOGOUT',
      actorId: actor.id,
      actorName: actor.name,
      role: actor.role,
      detail: `Déconnexion de ${name}`,
    });
    await this.presenceService.remove(actor.id, device);
    this.eventsGateway.broadcastOnlineUsers();
    this.eventsGateway.broadcastDataChange('user:logout', {
      userId: actor.id,
      name,
      role: actor.role,
    });
  }

  async verifyPassword(actor: any, password: string) {
    if (!password) return { valid: false };
    const user = await this.usersService.findById(actor?.id);
    if (!user) return { valid: false };
    const isMatch = await bcrypt.compare(password, user.password);
    return { valid: isMatch };
  }
}

