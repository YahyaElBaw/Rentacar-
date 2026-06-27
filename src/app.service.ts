import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getAppVersion(): string {
    return '1.1.0'; // Current Production Version
  }
}
