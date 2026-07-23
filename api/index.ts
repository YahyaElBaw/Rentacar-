import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Express, Request, Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const express: typeof import('express') = require('express');
import { AppModule } from '../src/app.module';

let cachedApp: Express;

async function bootstrap(): Promise<Express> {
  const expressApp = express();

  expressApp.use(express.json({ limit: '10mb' }));
  expressApp.use(express.urlencoded({ extended: true, limit: '10mb' }));

  expressApp.get('/favicon.ico', (_req, res) => res.status(204).end());

  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
    { bufferLogs: true },
  );

  app.enableCors();
  await app.init();

  return expressApp;
}

export default async function handler(req: Request, res: Response) {
  if (!cachedApp) {
    try {
      console.log('[Vercel] Bootstrapping NestJS...');
      cachedApp = await bootstrap();
      console.log('[Vercel] NestJS bootstrapped successfully');
    } catch (err) {
      console.error('[Vercel] Bootstrap failed:', err);
      res.status(500).json({
        error: 'Application bootstrap failed',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }

  cachedApp(req, res);
}
