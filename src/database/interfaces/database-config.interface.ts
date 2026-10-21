export interface DatabaseConfig {
  id: string;
  name: string;
  uri: string;
  originalUri?: string;
  role: 'primary' | 'backup';
  enabled: boolean;
  status?: 'healthy' | 'degraded' | 'down';
  latencyMs?: number;
  lastChecked?: string;
  syncStatus?: 'in_sync' | 'syncing' | 'failed' | 'not_synced';
  lastSyncedAt?: string;
  dbName?: string;
  hosts?: string[];
  replicaSet?: string;
}

export interface DatabaseRegistry {
  databases: DatabaseConfig[];
  autoFailover: boolean;
  realtimeSync: boolean;
  maxLatencyMs: number;
  activePrimaryId: string;
}

export interface ResolveUriResult {
  valid: boolean;
  normalizedUri: string;
  dbName: string;
  hosts: string[];
  replicaSet?: string;
  latencyMs?: number;
  error?: string;
}
