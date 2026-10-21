import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import {
  DatabaseConfig,
  DatabaseRegistry,
} from './interfaces/database-config.interface';

const keyCache = new Map<string, Buffer>();

function getEncryptionKey(secret: string): Buffer {
  const s = secret || 'rentcar-secret-default-salt-key-2026';
  let key = keyCache.get(s);
  if (!key) {
    key = scryptSync(s, 'db-registry-salt', 32);
    keyCache.set(s, key);
  }
  return key;
}

function encryptText(text: string, secret: string): string {
  if (!text || text.startsWith('enc:')) return text;
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(secret), iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch {
    return text;
  }
}

function decryptText(encryptedText: string, secret: string): string {
  if (!encryptedText || !encryptedText.startsWith('enc:')) return encryptedText;
  try {
    const [, ivHex, tagHex, dataHex] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(dataHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch {
    return encryptedText;
  }
}

@Injectable()
export class DatabaseConfigService {
  private readonly logger = new Logger(DatabaseConfigService.name);
  private readonly configPath: string;
  private readonly secretKey: string;
  private registry: DatabaseRegistry;

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('JWT_SECRET') || 'rentcar-secure-multi-db-key';
    const configDir = resolve(process.cwd(), 'config');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    this.configPath = resolve(configDir, 'databases.json');
    this.registry = this.loadRegistry();
  }

  private loadRegistry(): DatabaseRegistry {
    let registry: DatabaseRegistry | null = null;

    if (existsSync(this.configPath)) {
      try {
        const raw = readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.databases && Array.isArray(parsed.databases)) {
          for (const d of parsed.databases) {
            if (d.uri) d.uri = decryptText(d.uri, this.secretKey);
            if (d.originalUri) d.originalUri = decryptText(d.originalUri, this.secretKey);
          }
          registry = parsed;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to parse databases.json: ${err?.message}`);
      }
    }

    // Default configuration seeded from environment
    const primaryUri =
      this.configService.get<string>('MONGODB_URI') ||
      'mongodb://127.0.0.1:27017/rentacar';

    // Support both single BACKUP_MONGODB_URI and comma-separated BACKUP_MONGODB_URIS (ideal for Vercel)
    const backupEnvString =
      this.configService.get<string>('BACKUP_MONGODB_URIS') ||
      this.configService.get<string>('BACKUP_MONGODB_URI') ||
      '';

    const backupUris = backupEnvString
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.startsWith('mongodb://') || u.startsWith('mongodb+srv://'));

    if (!registry) {
      const databases: DatabaseConfig[] = [
        {
          id: 'primary',
          name: 'Cluster Principal (Production)',
          uri: primaryUri,
          role: 'primary',
          enabled: true,
          status: 'healthy',
          syncStatus: 'in_sync',
        },
      ];

      backupUris.forEach((uri, idx) => {
        databases.push({
          id: `backup-${idx + 1}`,
          name: idx === 0 ? 'Cluster Secours (Backup Haute Disponibilité)' : `Cluster Secours ${idx + 1}`,
          uri,
          role: 'backup',
          enabled: true,
          status: 'healthy',
          syncStatus: 'in_sync',
        });
      });

      registry = {
        databases,
        autoFailover: true,
        realtimeSync: true,
        maxLatencyMs: 4000,
        activePrimaryId: 'primary',
      };
    } else {
      // Auto-merge any new backup URIs defined in environment variables (Vercel)
      for (let i = 0; i < backupUris.length; i++) {
        const envUri = backupUris[i];
        const envHost = envUri.match(/@([^/?:]+)/)?.[1] || '';
        const exists = registry.databases.some(
          (d) =>
            d.uri === envUri ||
            (d as any).originalUri === envUri ||
            (envHost && (d.uri.includes(envHost) || (d as any).originalUri?.includes(envHost))),
        );
        if (!exists) {
          registry.databases.push({
            id: `backup-env-${i + 1}`,
            name: `Cluster Secours ${i + 1}`,
            uri: envUri,
            role: 'backup',
            enabled: true,
            status: 'healthy',
            syncStatus: 'in_sync',
          });
        }
      }
    }

    // Only save if databases.json already exists (will rewrite in encrypted format)
    if (existsSync(this.configPath)) {
      try {
        this.saveRegistry(registry);
      } catch {
        // Ignore on read-only environments (e.g. Vercel Lambda)
      }
    }

    return registry;
  }

  public getRegistry(): DatabaseRegistry {
    return this.registry;
  }

  public getDatabases(): DatabaseConfig[] {
    return this.registry.databases;
  }

  public getPrimaryDb(): DatabaseConfig | undefined {
    return (
      this.registry.databases.find((d) => d.id === this.registry.activePrimaryId) ||
      this.registry.databases.find((d) => d.role === 'primary') ||
      this.registry.databases[0]
    );
  }

  public getBackupDbs(): DatabaseConfig[] {
    const primary = this.getPrimaryDb();
    return this.registry.databases.filter(
      (d) => d.enabled && d.id !== primary?.id,
    );
  }

  public addDatabase(db: DatabaseConfig): void {
    const existingIdx = this.registry.databases.findIndex((d) => d.id === db.id);
    if (existingIdx !== -1) {
      this.registry.databases[existingIdx] = { ...this.registry.databases[existingIdx], ...db };
    } else {
      this.registry.databases.push(db);
    }
    this.saveRegistry(this.registry);
  }

  public updateRuntimeStatus(id: string, updates: Partial<DatabaseConfig>): void {
    const db = this.registry.databases.find((d) => d.id === id);
    if (db) {
      Object.assign(db, updates);
    }
  }

  public updateDatabase(id: string, updates: Partial<DatabaseConfig>): void {
    const db = this.registry.databases.find((d) => d.id === id);
    if (db) {
      Object.assign(db, updates);
      const persistentKeys: (keyof DatabaseConfig)[] = ['name', 'uri', 'originalUri', 'role', 'enabled'];
      const hasPersistentChanges = persistentKeys.some((k) => k in updates);
      if (hasPersistentChanges) {
        this.saveRegistry(this.registry);
      }
    }
  }

  public removeDatabase(id: string): boolean {
    const primary = this.getPrimaryDb();
    if (primary && primary.id === id) {
      throw new Error('Impossible de supprimer la base de données principale active.');
    }
    const lenBefore = this.registry.databases.length;
    this.registry.databases = this.registry.databases.filter((d) => d.id !== id);
    this.saveRegistry(this.registry);
    return this.registry.databases.length < lenBefore;
  }

  public setPrimary(id: string): void {
    const target = this.registry.databases.find((d) => d.id === id);
    if (!target) {
      throw new Error('Base de données introuvable.');
    }
    for (const d of this.registry.databases) {
      if (d.id === id) {
        d.role = 'primary';
      } else {
        d.role = 'backup';
      }
    }
    this.registry.activePrimaryId = id;
    this.saveRegistry(this.registry);
    this.logger.log(`Switched active primary database to: ${target.name} (${id})`);
  }

  public updateSettings(settings: {
    autoFailover?: boolean;
    realtimeSync?: boolean;
    maxLatencyMs?: number;
  }): void {
    if (settings.autoFailover !== undefined) this.registry.autoFailover = settings.autoFailover;
    if (settings.realtimeSync !== undefined) this.registry.realtimeSync = settings.realtimeSync;
    if (settings.maxLatencyMs !== undefined) this.registry.maxLatencyMs = settings.maxLatencyMs;
    this.saveRegistry(this.registry);
  }

  private saveRegistry(registry: DatabaseRegistry): void {
    try {
      const encryptedDatabases = registry.databases.map((d) => ({
        ...d,
        uri: encryptText(d.uri, this.secretKey),
        originalUri: d.originalUri ? encryptText(d.originalUri, this.secretKey) : undefined,
      }));
      const payload = {
        ...registry,
        databases: encryptedDatabases,
      };
      writeFileSync(this.configPath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err: any) {
      this.logger.error(`Failed to save databases.json: ${err?.message}`);
    }
  }
}
