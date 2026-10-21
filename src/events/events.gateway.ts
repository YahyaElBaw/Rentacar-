import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { PresenceService } from '../presence/presence.service';

export interface ActiveUser {
  socketId: string;
  userId: string;
  name: string;
  role: string;
  connectedAt: Date;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(private readonly presenceService: PresenceService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.broadcastOnlineUsers();
  }

  @SubscribeMessage('user:identify')
  handleUserIdentify(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { userId: string; name: string; role: string },
  ) {
    if (payload && payload.userId) {
      this.logger.log(`User identified: ${payload.name} (${payload.role}) on socket ${client.id}`);
      // Presence itself is owned by login + API activity; just refresh the broadcast.
      this.broadcastOnlineUsers();
    }
  }

  @SubscribeMessage('user:logout')
  handleUserLogout(@ConnectedSocket() client: Socket) {
    void this.presenceService.cleanup().then(() => {
      this.broadcastOnlineUsers();
    });
  }

  broadcastOnlineUsers() {
    if (!this.server) return;
    this.presenceService
      .getOnline()
      .then((data) => {
        this.server.emit('users:online', data);
      })
      .catch((err) => this.logger.error(`Failed to broadcast online users: ${err?.message}`));
  }

  broadcastDataChange(event: string, data?: any) {
    this.logger.log(`Broadcasting event ${event}`);
    if (this.server) {
      this.server.emit(event, {
        timestamp: new Date().toISOString(),
        data,
      });
    }
  }
}
