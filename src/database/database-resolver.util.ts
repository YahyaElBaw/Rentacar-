import dnsPromises from 'dns/promises';
import type { SrvRecord } from 'dns';
import mongoose from 'mongoose';
import { ResolveUriResult } from './interfaces/database-config.interface';

/**
 * Auto-generates and normalizes robust direct replicaSet connection strings
 * from any MongoDB link, especially mongodb+srv:// Atlas links.
 */
export async function resolveAndNormalizeMongoUri(rawUri: string): Promise<ResolveUriResult> {
  const uri = (rawUri || '').trim();
  if (!uri) {
    throw new Error('Le lien de connexion MongoDB ne peut pas être vide.');
  }

  // Use public DNS servers to prevent Windows local DNS SRV resolution failures
  try {
    dnsPromises.setServers(['8.8.8.8', '1.1.1.1']);
  } catch {}

  let normalizedUri = uri;
  let dbName = 'rentacar';
  let hosts: string[] = [];
  let replicaSet = '';

  if (uri.startsWith('mongodb+srv://')) {
    // Parse mongodb+srv://[user:pass@]hostname[/dbname][?options]
    const match = uri.match(/^mongodb\+srv:\/\/(?:([^:]+):([^@]+)@)?([^\/\?]+)(?:\/([^?]+))?(?:\?(.*))?$/);
    if (!match) {
      throw new Error('Format de lien mongodb+srv:// invalide.');
    }

    const [, user, pass, hostname, extractedDb, queryParams] = match;
    dbName = extractedDb || 'rentacar';

    // 1. Resolve SRV records: _mongodb._tcp.<hostname>
    let srvRecords: SrvRecord[] = [];
    try {
      srvRecords = await dnsPromises.resolveSrv(`_mongodb._tcp.${hostname}`);
    } catch (err: any) {
      throw new Error(`Impossible de résoudre les hôtes SRV pour ${hostname}: ${err?.message || err}`);
    }

    if (!srvRecords || srvRecords.length === 0) {
      throw new Error(`Aucun serveur MongoDB trouvé pour ${hostname}`);
    }

    hosts = srvRecords.map((r) => `${r.name}:${r.port}`);

    // 2. Resolve TXT records to extract replicaSet & authSource
    let authSource = 'admin';
    try {
      const txtRecords = await dnsPromises.resolveTxt(hostname);
      const txtJoined = txtRecords.flat().join('&');
      const params = new URLSearchParams(txtJoined);
      if (params.get('replicaSet')) replicaSet = params.get('replicaSet')!;
      if (params.get('authSource')) authSource = params.get('authSource')!;
    } catch {
      // Optional fallback
    }

    // 3. Build bulletproof direct replicaSet URI
    const authPart = user && pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
    normalizedUri = `mongodb://${authPart}${hosts.join(',')}/${dbName}?tls=true`;
    if (replicaSet) normalizedUri += `&replicaSet=${replicaSet}`;
    if (authSource) normalizedUri += `&authSource=${authSource}`;
    normalizedUri += '&retryWrites=true&w=majority';
  } else if (uri.startsWith('mongodb://')) {
    normalizedUri = uri;
    // Extract db name and hosts
    const clean = uri.replace(/^mongodb:\/\/(?:[^@]+@)?/, '');
    const slashIdx = clean.indexOf('/');
    if (slashIdx !== -1) {
      const hostPart = clean.substring(0, slashIdx);
      hosts = hostPart.split(',').map((h) => h.trim());
      const rest = clean.substring(slashIdx + 1);
      const qIdx = rest.indexOf('?');
      dbName = qIdx !== -1 ? rest.substring(0, qIdx) : rest;
    } else {
      hosts = clean.split(',').map((h) => h.trim());
    }
  } else {
    throw new Error('Le lien doit commencer par mongodb:// ou mongodb+srv://');
  }

  // 4. Test connection & measure latency
  const pingStart = Date.now();
  let conn: mongoose.Connection | null = null;
  try {
    conn = await mongoose.createConnection(normalizedUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    }).asPromise();

    const admin = conn.db?.admin();
    if (admin) {
      await admin.ping();
    }
    const latencyMs = Date.now() - pingStart;

    await conn.close();

    return {
      valid: true,
      normalizedUri,
      dbName: dbName || 'rentacar',
      hosts,
      replicaSet: replicaSet || undefined,
      latencyMs,
    };
  } catch (err: any) {
    if (conn) {
      try {
        await conn.close();
      } catch {}
    }
    throw new Error(`Échec de connexion à la base de données: ${err?.message || err}`);
  }
}
