import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PresenceService } from './presence.service';

@Injectable()
export class PresenceInterceptor implements NestInterceptor {
  constructor(private readonly presenceService: PresenceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    const url: string = req?.originalUrl || req?.url || '';
    if (user?.id && !url.includes('/presence')) {
      const ua: string = req?.headers?.['user-agent'] || '';
      const device = /okhttp|ReactNative|Expo|dart:io|Android|iPhone|iPad|Mobile/i.test(ua)
        ? 'phone'
        : 'pc';
      this.presenceService
        .touch(user.id, device, user.name, user.role)
        .catch(() => {
          /* ignore */
        });
    }
    return next.handle();
  }
}
