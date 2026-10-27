import express from 'express';
import 'dotenv/config';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { rateLimit } from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_STORE_CONFIG, LIMITS } from './src/constants.ts';
import {
  CustomerGuaranteeClaim,
  GuaranteeClaim,
  OrderRecord,
  PaymentStatus,
  PackType,
  StoreConfig,
  VaultItem,
  VaultPoolType,
} from './src/types.ts';
import { deliverOnce, submitUtr } from './src/paymentDelivery.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const DATA_FILE = path.join(DATA_DIR, 'roshanbrand_store.json');
const SEED_DATA_FILE = path.join(DEFAULT_DATA_DIR, 'roshanbrand_store.json');
const ADMIN_AUTH_FILE = path.join(DATA_DIR, 'admin_auth.json');
const ADMIN_SESSION_FILE = path.join(DATA_DIR, 'admin_sessions.json');
const postgresPool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
let persistenceQueue: Promise<void> = Promise.resolve();
let lastPersistedState = '';
let persistenceVersion = 0;
const requestTransaction = new AsyncLocalStorage<{
  client: import('pg').PoolClient;
  committed: boolean;
}>();

interface AdminAuthRecord {
  salt: string;
  passwordHash: string;
}

interface PersistedDatabase {
  storeConfig: StoreConfig;
  orders: OrderRecord[];
  vault: VaultItem[];
  utrIndex: Record<string, string>;
  orderAccessTokens: Record<string, string>;
  guaranteeClaims: GuaranteeClaim[];
}

function buildInitialVault(): VaultItem[] {
  return [];
}

function ensureDataDirectory(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAdminSessionStore(): Record<string, number> {
  try {
    if (!fs.existsSync(ADMIN_SESSION_FILE)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(ADMIN_SESSION_FILE, 'utf-8')) as Record<string, unknown>;
    const entries: Record<string, number> = {};
    for (const [tokenHash, expiresAt] of Object.entries(parsed)) {
      const expiry = Number(expiresAt);
      if (Number.isFinite(expiry)) {
        entries[tokenHash] = expiry;
      }
    }
    return entries;
  } catch {
    return {};
  }
}

const fallbackAdminSessions = loadAdminSessionStore();

function persistAdminSessionStore(): void {
  try {
    ensureDataDirectory();
    fs.writeFileSync(ADMIN_SESSION_FILE, JSON.stringify(fallbackAdminSessions), 'utf-8');
  } catch {
    // Ignore write failures in local-only mode so the site still boots.
  }
}

function loadDb(): PersistedDatabase {
  const sourceFile = fs.existsSync(DATA_FILE) ? DATA_FILE : SEED_DATA_FILE;
  if (fs.existsSync(sourceFile)) {
    try {
      const raw = fs.readFileSync(sourceFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedDatabase>;
      const savedStoreConfig = Object.fromEntries(
        Object.entries(parsed.storeConfig || {}).filter(
          ([key]) =>
            key !== 'presetRentalCredentials' && key !== 'presetPermanentCredentials'
        )
      ) as Partial<StoreConfig>;
      const orders = Array.isArray(parsed.orders) ? parsed.orders : [];
      const orderAccessTokens =
        parsed.orderAccessTokens && typeof parsed.orderAccessTokens === 'object'
          ? parsed.orderAccessTokens
          : {};
      const verifiedUtrIndex: Record<string, string> = {};
      for (const order of orders) {
        order.deliveredCredentials = sanitizeDeliveredCredentials(
          order.deliveredCredentials || ''
        );
        if (order.status === 'verified_delivered' && !verifiedUtrIndex[order.utrNumber]) {
          verifiedUtrIndex[order.utrNumber] = order.orderId;
        }
      }
      const customerPerId =
        normalizeStock(
          savedStoreConfig.priceCustomPerId,
          DEFAULT_STORE_CONFIG.priceCustomPerId
        ) || DEFAULT_STORE_CONFIG.priceCustomPerId;
      return {
        storeConfig: {
          ...DEFAULT_STORE_CONFIG,
          ...savedStoreConfig,
          supportUrl: normalizeSupportUrl(
            savedStoreConfig.supportUrl,
            DEFAULT_STORE_CONFIG.supportUrl
          ),
          adminDisplayName: String(
            savedStoreConfig.adminDisplayName || DEFAULT_STORE_CONFIG.adminDisplayName
          )
            .trim()
            .slice(0, 80),
          maxGuaranteeReplacementsPerOrder: normalizeReplacementLimit(
            savedStoreConfig.maxGuaranteeReplacementsPerOrder,
            DEFAULT_STORE_CONFIG.maxGuaranteeReplacementsPerOrder
          ),
          priceRental24h: normalizePrice(
            savedStoreConfig.priceRental24h,
            DEFAULT_STORE_CONFIG.priceRental24h
          ),
          priceCustomPerId: customerPerId,
          price1Id: customerPerId,
          price2Id: customerPerId * 2,
          price5Id: customerPerId * 5,
          price10Id: customerPerId * 10,
          priceBulkPerId: customerPerId,
          price7DayGuaranteePerId: normalizeStock(
            savedStoreConfig.price7DayGuaranteePerId,
            DEFAULT_STORE_CONFIG.price7DayGuaranteePerId
          ) || DEFAULT_STORE_CONFIG.price7DayGuaranteePerId,
          price1MonthGuaranteePerId: normalizeStock(
            savedStoreConfig.price1MonthGuaranteePerId,
            DEFAULT_STORE_CONFIG.price1MonthGuaranteePerId
          ) || DEFAULT_STORE_CONFIG.price1MonthGuaranteePerId,
          announcementText:
            typeof savedStoreConfig.announcementText === 'string'
              ? savedStoreConfig.announcementText.toUpperCase().includes('INSTANT UPI UTR VERIFICATION')
                ? DEFAULT_STORE_CONFIG.announcementText
                : savedStoreConfig.announcementText
                    .replace(/\s*[·•-]?\s*PAYMENT CONFIRMATION REQUIRED/gi, '')
                    .trim()
              : DEFAULT_STORE_CONFIG.announcementText,
          upiId: normalizeUpiId(savedStoreConfig.upiId, DEFAULT_STORE_CONFIG.upiId),
          instantAutoVerify: false,
          instantDeliveryNote: DEFAULT_STORE_CONFIG.instantDeliveryNote,
          stockDisplayAvailable: normalizeStock(
            savedStoreConfig.stockDisplayAvailable,
            normalizeStock(savedStoreConfig.stockAvailable, DEFAULT_STORE_CONFIG.stockDisplayAvailable)
          ),
          rentalStockDisplayAvailable: normalizeStock(
            savedStoreConfig.rentalStockDisplayAvailable,
            normalizeStock(
              savedStoreConfig.rentalStockAvailable,
              DEFAULT_STORE_CONFIG.rentalStockDisplayAvailable
            )
          ),
          stock7DayGuaranteeAvailable: normalizeStock(
            savedStoreConfig.stock7DayGuaranteeAvailable,
            DEFAULT_STORE_CONFIG.stock7DayGuaranteeAvailable
          ),
          stock1MonthGuaranteeAvailable: normalizeStock(
            savedStoreConfig.stock1MonthGuaranteeAvailable,
            DEFAULT_STORE_CONFIG.stock1MonthGuaranteeAvailable
          ),
        },
        orders,
        vault: Array.isArray(parsed.vault)
          ? parsed.vault.map((item) => ({
              ...item,
              accountNote: sanitizeVaultNote(String(item.accountNote || '')),
            }))
          : buildInitialVault(),
        utrIndex: verifiedUtrIndex,
        orderAccessTokens,
        guaranteeClaims: Array.isArray(parsed.guaranteeClaims) ? parsed.guaranteeClaims : [],
      };
    } catch (err) {
      console.error('Failed to read store data file; refusing to initialize defaults:', err);
      throw err;
    }
  }

  return {
    storeConfig: { ...DEFAULT_STORE_CONFIG },
    orders: [],
    vault: buildInitialVault(),
    utrIndex: {},
    orderAccessTokens: {},
    guaranteeClaims: [],
  };
}

async function initializePersistence(db: PersistedDatabase): Promise<void> {
  if (!postgresPool) {
    ensureDataDirectory();
    const seededDb = loadDb();
    Object.assign(db, seededDb);
    db.orderAccessTokens ||= {};
    db.guaranteeClaims ||= [];
    lastPersistedState = JSON.stringify(db);
    return;
  }

  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS roshanbrand_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS roshanbrand_admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      product TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      status TEXT NOT NULL CHECK (status IN ('pending', 'utr_submitted', 'paid', 'expired', 'rejected')),
      utr TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      delivered SMALLINT NOT NULL DEFAULT 0 CHECK (delivered IN (0, 1)),
      pack_label TEXT NOT NULL,
      customer_reference TEXT NOT NULL,
      custom_spec TEXT NOT NULL
    )
  `);
  await postgresPool.query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check');
  await postgresPool.query(`
    ALTER TABLE orders
    ADD CONSTRAINT orders_status_check
    CHECK (status IN ('pending', 'utr_submitted', 'paid', 'expired', 'rejected'))
  `);
  await postgresPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS orders_utr_unique
    ON orders (utr) WHERE utr IS NOT NULL
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      utr TEXT PRIMARY KEY,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      received_at TIMESTAMPTZ NOT NULL,
      used_order_id TEXT REFERENCES orders(id),
      raw_message TEXT NOT NULL
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS verify_attempts (
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      client_key TEXT NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      blocked_until TIMESTAMPTZ,
      last_utr TEXT,
      PRIMARY KEY (order_id, client_key)
    )
  `);
  await postgresPool.query('ALTER TABLE verify_attempts ADD COLUMN IF NOT EXISTS last_utr TEXT');
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS manual_payment_logs (
      id BIGSERIAL PRIMARY KEY,
      order_id TEXT NOT NULL,
      action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL CHECK (source = 'manual')
    )
  `);

  const existing = await postgresPool.query<{ state: PersistedDatabase }>(
    'SELECT state FROM roshanbrand_state WHERE id = 1'
  );
  if (existing.rows[0]) {
    Object.assign(db, existing.rows[0].state);
    db.orderAccessTokens ||= {};
    lastPersistedState = JSON.stringify(db);
    return;
  }

  // Import the previous file-backed state only when the persistent DB is empty.
  await postgresPool.query(
    `INSERT INTO roshanbrand_state (id, state)
     VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(db)]
  );
  const initialized = await postgresPool.query<{ state: PersistedDatabase }>(
    'SELECT state FROM roshanbrand_state WHERE id = 1'
  );
  if (!initialized.rows[0]) {
    throw new Error('Could not initialize persistent application state.');
  }
  Object.assign(db, initialized.rows[0].state);
  db.orderAccessTokens ||= {};
  lastPersistedState = JSON.stringify(db);
}

function saveDb(db: PersistedDatabase): Promise<void> {
  const state = JSON.stringify(db);
  if (!postgresPool) {
    ensureDataDirectory();
    fs.writeFileSync(DATA_FILE, state, 'utf-8');
    lastPersistedState = state;
    return Promise.resolve();
  }
  const transaction = requestTransaction.getStore();
  if (transaction) {
    return transaction.client
      .query(
        'UPDATE roshanbrand_state SET state = $1::jsonb, updated_at = NOW() WHERE id = 1',
        [state]
      )
      .then(() => transaction.client.query('COMMIT'))
      .then(() => {
        transaction.committed = true;
        lastPersistedState = state;
      });
  }
  const version = ++persistenceVersion;
  const write = persistenceQueue.then(() =>
    postgresPool.query(
      `INSERT INTO roshanbrand_state (id, state, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id)
       DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
      [state]
    ).then(() => {
      lastPersistedState = state;
    })
  );
  persistenceQueue = write.catch((error: unknown) => {
    console.error('Failed to persist application state to PostgreSQL:', error);
    if (version === persistenceVersion && lastPersistedState) {
      Object.assign(db, JSON.parse(lastPersistedState) as PersistedDatabase);
    }
  });
  return write;
}

async function persistDbOrRespond(res: express.Response): Promise<boolean> {
  try {
    await saveDb(db);
    return true;
  } catch {
    res.status(500).json({ error: 'Application data could not be saved to PostgreSQL.' });
    return false;
  }
}

function normalizeStock(value: unknown, fallback: number): number {
  const stock = Number(value);
  return Number.isFinite(stock)
    ? Math.max(0, Math.min(100000, Math.floor(stock)))
    : fallback;
}

function normalizePrice(value: unknown, fallback: number): number {
  const price = Number(value);
  return Number.isFinite(price) && price >= 1
    ? Math.min(100000, Math.floor(price))
    : fallback;
}

function normalizeReplacementLimit(value: unknown, fallback: number): number {
  const limit = Number(value);
  return Number.isFinite(limit) && Number.isInteger(limit)
    ? Math.max(0, Math.min(20, limit))
    : fallback;
}

function normalizeUpiId(value: unknown, fallback: string): string {
  const upiId = String(value ?? '').trim();
  return upiId.length >= LIMITS.UPI_ID_MIN &&
    upiId.length <= LIMITS.UPI_ID_MAX &&
    LIMITS.UPI_ID_REGEX.test(upiId)
    ? upiId
    : fallback;
}

function normalizeSupportUrl(value: unknown, fallback: string): string {
  const supportUrl = String(value ?? '').trim();
  try {
    const url = new URL(supportUrl);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'wa.me' &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/\d{8,15}$/.test(url.pathname) &&
      !url.search &&
      !url.hash
    ) {
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    // Use the configured fallback when legacy settings contain an invalid URL.
  }
  return fallback;
}

function getGuaranteeExpiry(order: OrderRecord): Date | null {
  if (order.packType !== 'guarantee_7days' && order.packType !== 'guarantee_1month') {
    return null;
  }
  const originalDate = new Date(order.verifiedAt || order.createdAt);
  if (!Number.isFinite(originalDate.getTime())) return null;
  if (order.packType === 'guarantee_7days') {
    return new Date(originalDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  const year = originalDate.getUTCFullYear();
  const month = originalDate.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  originalDate.setUTCDate(Math.min(originalDate.getUTCDate(), lastDay));
  originalDate.setUTCMonth(month);
  return originalDate;
}

function getRentalExpiry(order: OrderRecord): Date | null {
  if (!order.isRental24h) return null;
  const recorded = order.rentalExpiresAt ? new Date(order.rentalExpiresAt) : null;
  if (recorded && Number.isFinite(recorded.getTime())) return recorded;
  const deliveredAt = new Date(order.verifiedAt || order.createdAt);
  return Number.isFinite(deliveredAt.getTime())
    ? new Date(deliveredAt.getTime() + 24 * 60 * 60 * 1000)
    : null;
}

function toCustomerGuaranteeClaim(claim: GuaranteeClaim): CustomerGuaranteeClaim {
  return {
    claimId: claim.claimId,
    orderId: claim.orderId,
    credentialIndex: claim.credentialIndex,
    guaranteeType: claim.guaranteeType,
    expiresAt: claim.expiresAt,
    status: claim.status,
    createdAt: claim.createdAt,
    rejectionReason: claim.rejectionReason,
    resolution: claim.resolution,
  };
}

function isValidScreenshotDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/]+={0,2})$/);
  return Boolean(match && Buffer.from(match[2], 'base64').byteLength <= 1024 * 1024);
}

function getVaultPoolForPackType(packType: PackType): VaultPoolType {
  if (packType === 'rental_24h') return 'rental_24h';
  if (packType === 'guarantee_7days') return 'guarantee_7days';
  if (packType === 'guarantee_1month') return 'guarantee_1month';
  return 'permanent';
}

function syncVaultDisplayCounter(poolType: VaultPoolType) {
  const availableCount = db.vault.filter(
    (item) =>
      item.poolType === poolType && !item.isAssigned && !item.reservedOrderId
  ).length;

  if (poolType === 'rental_24h') {
    db.storeConfig.rentalStockDisplayAvailable = availableCount;
  } else if (poolType === 'permanent') {
    db.storeConfig.stockDisplayAvailable = availableCount;
  } else if (poolType === 'guarantee_7days') {
    db.storeConfig.stock7DayGuaranteeAvailable = availableCount;
  } else {
    db.storeConfig.stock1MonthGuaranteeAvailable = availableCount;
  }
}

function getVaultPoolLabel(poolType: VaultPoolType): string {
  switch (poolType) {
    case 'rental_24h':
      return '24H Rental';
    case 'guarantee_7days':
      return '7 Days Guarantee';
    case 'guarantee_1month':
      return '1 Month Guarantee';
    default:
      return 'Permanent';
  }
}

function sanitizeVaultNote(note: string): string {
  return note
    .split(/[|·]/)
    .filter((part) => !/^\s*(?:Txn)?Pin\s*:/i.test(part))
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ');
}

function sanitizeDeliveredCredentials(credentials: string): string {
  return credentials
    .split('\n')
    .map((line) =>
      line
        .split(/[|·]/)
        .filter(
          (part) =>
            !/^\s*(?:Txn)?Pin\s*:/i.test(part) &&
            !/^\s*24H Active Rental\s*$/i.test(part)
        )
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' | ')
    )
    .filter(Boolean)
    .join('\n');
}

function isPackType(value: unknown): value is PackType {
  return [
    'pack_1',
    'pack_2',
    'pack_5',
    'pack_10',
    'bulk',
    'custom',
    'rental_24h',
    'guarantee_7days',
    'guarantee_1month',
  ].includes(String(value));
}

const db = loadDb();

// Real-time SSE clients for instant <50ms Admin & Customer sync
const sseClients = new Set<express.Response>();

function broadcastStateUpdate(eventType: string, _payload?: unknown) {
  const message = `data: ${JSON.stringify({ type: eventType, ts: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Pulls credentials only from unassigned items in the matching Ready ID Vault pool.
 */
function allocateCredentials(
  quantity: number,
  packType: PackType,
  orderId: string
): string | null {
  const targetPool = getVaultPoolForPackType(packType);
  const availableInPool = db.vault.filter(
    (v) =>
      !v.isAssigned &&
      v.poolType === targetPool &&
      (!v.reservedOrderId || v.reservedOrderId === orderId)
  );
  if (availableInPool.length < quantity) {
    return null;
  }

  const allocatedLines: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < quantity; i++) {
    const vaultItem = availableInPool[i];
    vaultItem.isAssigned = true;
    vaultItem.assignedOrderId = orderId;
    vaultItem.reservedOrderId = undefined;
    vaultItem.updatedAt = now;
    allocatedLines.push(
      `Username: ${vaultItem.irctcUsername} | Password: ${vaultItem.irctcPassword}${
        vaultItem.accountNote ? ` | ${vaultItem.accountNote}` : ''
      }`
    );
  }

  return allocatedLines.join('\n');
}

function deliverOrder(
  order: OrderRecord,
  requestedCredentials = ''
): boolean {
  let credentials: string | null;
  if (requestedCredentials.trim()) {
    const targetPool = getVaultPoolForPackType(order.packType);
    const credentialLines = requestedCredentials
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const matchedItems = credentialLines.map((line) => {
      const username = (line.split(/[|:,]/)[0] || '').replace(/^Username:\s*/i, '').trim();
      return db.vault.find(
        (item) =>
          item.poolType === targetPool &&
          item.irctcUsername === username &&
          ((!item.isAssigned && (!item.reservedOrderId || item.reservedOrderId === order.orderId)) ||
            item.assignedOrderId === order.orderId)
      );
    });
    if (
      credentialLines.length !== order.quantity ||
      matchedItems.some((item) => !item) ||
      new Set(matchedItems.map((item) => item?.vaultId)).size !== order.quantity
    ) {
      return false;
    }

    const nowIso = new Date().toISOString();
    credentials = matchedItems
      .map((item) => {
        if (!item) return '';
        item.isAssigned = true;
        item.assignedOrderId = order.orderId;
        item.reservedOrderId = undefined;
        item.updatedAt = nowIso;
        return `Username: ${item.irctcUsername} | Password: ${item.irctcPassword}${
          item.accountNote ? ` | ${item.accountNote}` : ''
        }`;
      })
      .join('\n');
  } else {
    credentials = allocateCredentials(order.quantity, order.packType, order.orderId);
  }
  if (credentials === null) return false;

  const now = new Date();
  order.status = 'verified_delivered';
  order.paymentStatus = 'paid';
  order.deliveredCredentials = sanitizeDeliveredCredentials(credentials).slice(
    0,
    LIMITS.CREDENTIALS_MAX
  );
  order.updatedAt = now.toISOString();
  order.verifiedAt ||= now.toISOString();
  if (order.isRental24h && !order.rentalExpiresAt) {
    order.rentalExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
  order.adminNote = 'Payment manually confirmed by admin; Ready Vault ID delivered.';

  if (!db.orders.some((existing) => existing.orderId === order.orderId)) {
    db.orders.unshift(order);
  }
  if (order.utrNumber) db.utrIndex[order.utrNumber] = order.orderId;
  return true;
}

/**
 * Preview what credentials will be used for an order from Ready Vault without mutating state yet.
 */
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

  if (process.env.NODE_ENV === 'production' && !postgresPool) {
    throw new Error('DATABASE_URL is required when NODE_ENV is production.');
  }

  await initializePersistence(db);
  db.storeConfig = {
    ...DEFAULT_STORE_CONFIG,
    ...db.storeConfig,
    maxGuaranteeReplacementsPerOrder: normalizeReplacementLimit(
      db.storeConfig.maxGuaranteeReplacementsPerOrder,
      DEFAULT_STORE_CONFIG.maxGuaranteeReplacementsPerOrder
    ),
  };
  db.guaranteeClaims ||= [];
  const legacyStoreConfig = db.storeConfig as StoreConfig & Record<string, unknown>;
  let storeConfigMigrated = false;
  for (const legacyKey of ['presetRentalCredentials', 'presetPermanentCredentials']) {
    if (legacyKey in legacyStoreConfig) {
      delete legacyStoreConfig[legacyKey];
      storeConfigMigrated = true;
    }
  }
  const supportUrl = normalizeSupportUrl(
    legacyStoreConfig.supportUrl,
    DEFAULT_STORE_CONFIG.supportUrl
  );
  if (legacyStoreConfig.supportUrl !== supportUrl) {
    legacyStoreConfig.supportUrl = supportUrl;
    storeConfigMigrated = true;
  }
  if (storeConfigMigrated) {
    await saveDb(db);
  }
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    if (
      req.path === '/create-order' ||
      req.path === '/sms-webhook' ||
      req.path === '/verify-utr' ||
      /^\/order-status\/[^/]+$/.test(req.path)
    ) {
      req.url = `/api${req.url}`;
    }
    next();
  });

  app.use('/api', async (req, res, next) => {
    if (!postgresPool) {
      next();
      return;
    }
    if (req.path === '/events' || req.path.startsWith('/admin/auth/')) {
      next();
      return;
    }
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const isAdminStateRead = req.method === 'GET' && req.path === '/admin/state';
    const client = await postgresPool.connect();
    const transaction = { client, committed: false };
    try {
      await client.query('BEGIN');
      if (isAdminStateRead) {
        const result = await client.query('SELECT id FROM roshanbrand_state WHERE id = 1 FOR SHARE');
        if (!result.rows[0]) throw new Error('Persistent application state is missing.');
      } else {
        const result = await client.query<{ state: PersistedDatabase }>(
          `SELECT state FROM roshanbrand_state WHERE id = 1 FOR ${isMutation ? 'UPDATE' : 'SHARE'}`
        );
        if (!result.rows[0]) throw new Error('Persistent application state is missing.');
        Object.assign(db, result.rows[0].state);
        db.orderAccessTokens ||= {};
        db.guaranteeClaims ||= [];
      }
      let finalized = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        void (async () => {
          try {
            if (!transaction.committed) {
              if (isMutation || res.destroyed) {
                await client.query('ROLLBACK');
                if (isMutation) {
                  const current = await client.query<{ state: PersistedDatabase }>(
                    'SELECT state FROM roshanbrand_state WHERE id = 1'
                  );
                  if (current.rows[0]) Object.assign(db, current.rows[0].state);
                }
              } else {
                await client.query('COMMIT');
              }
            }
          } catch (error) {
            console.error('Failed to finalize application-state transaction:', error);
          } finally {
            client.release();
          }
        })();
      };
      res.once('finish', finalize);
      res.once('close', finalize);
      requestTransaction.run(transaction, () => next());
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      next(error);
    }
  });

  const loginFailures = new Map<string, { count: number; resetAt: number }>();
  const derivePasswordHash = (password: string, salt: Buffer) =>
    new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      });
    });
  const createAuthRecord = async (password: string): Promise<AdminAuthRecord> => {
    const salt = randomBytes(16);
    const passwordHash = await derivePasswordHash(password, salt);
    return { salt: salt.toString('hex'), passwordHash: passwordHash.toString('hex') };
  };
  const persistAuthRecord = (record: AdminAuthRecord) => {
    fs.writeFileSync(ADMIN_AUTH_FILE, JSON.stringify(record), 'utf-8');
  };

  let adminAuth: AdminAuthRecord | null = null;
  try {
    if (fs.existsSync(ADMIN_AUTH_FILE)) {
      adminAuth = JSON.parse(fs.readFileSync(ADMIN_AUTH_FILE, 'utf-8')) as AdminAuthRecord;
    }
  } catch (error) {
    console.error('Failed to read admin authentication data:', error);
  }
  if (!adminAuth && process.env.ADMIN_PASSWORD) {
    adminAuth = await createAuthRecord(process.env.ADMIN_PASSWORD);
    persistAuthRecord(adminAuth);
  }

  const sessionCookie = 'rb_admin_session';
  const sessionMaxAgeSeconds = 12 * 60 * 60;
  const orderAccessCookieName = (orderId: string) =>
    /^[A-Za-z0-9_-]{1,100}$/.test(orderId) ? `rb_order_access_${orderId}` : '';
  const getOrderAccessCookie = (req: express.Request, orderId: string) => {
    const cookieName = orderAccessCookieName(orderId);
    if (!cookieName) return '';
    const cookie = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`));
    if (!cookie) return '';
    try {
      return decodeURIComponent(cookie.slice(cookieName.length + 1));
    } catch {
      return '';
    }
  };
  const getAuthorizedOrderAccessToken = (
    req: express.Request,
    orderId: string,
    expectedHash: string | undefined,
    suppliedToken: unknown
  ) => {
    if (!expectedHash) return '';
    const expectedDigest = Buffer.from(expectedHash, 'hex');
    const tokens = [String(suppliedToken || '').trim(), getOrderAccessCookie(req, orderId)];
    const authorizedToken = tokens.find((token) => {
      if (!/^[a-f0-9]{64}$/i.test(token)) return false;
      const suppliedHash = createHash('sha256').update(token).digest();
      return suppliedHash.length === expectedDigest.length &&
        timingSafeEqual(suppliedHash, expectedDigest);
    });
    return authorizedToken || '';
  };
  const setOrderAccessCookie = (
    res: express.Response,
    orderId: string,
    accessToken: string
  ) => {
    const cookieName = orderAccessCookieName(orderId);
    if (!cookieName) return;
    res.append(
      'Set-Cookie',
      `${cookieName}=${encodeURIComponent(accessToken)}; Path=/api/orders; HttpOnly; SameSite=Strict; Max-Age=${45 * 24 * 60 * 60}${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''
      }`
    );
  };
  const clearSessionCookie = (res: express.Response) => {
    res.setHeader(
      'Set-Cookie',
      `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''
      }`
    );
  };
  const getSessionToken = (req: express.Request) => {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${sessionCookie}=`));
    return cookie ? decodeURIComponent(cookie.slice(sessionCookie.length + 1)) : '';
  };
  const isAdminAuthenticated = async (req: express.Request) => {
    const token = getSessionToken(req);
    if (!token) return false;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    if (!postgresPool) {
      const expiresAt = fallbackAdminSessions[tokenHash];
      if (!expiresAt || expiresAt <= Date.now()) {
        delete fallbackAdminSessions[tokenHash];
        persistAdminSessionStore();
        return false;
      }
      return true;
    }
    const client = requestTransaction.getStore()?.client;
    const query = client ? client.query.bind(client) : postgresPool.query.bind(postgresPool);
    const result = await query(
      'DELETE FROM roshanbrand_admin_sessions WHERE token_hash = $1 AND expires_at <= NOW() RETURNING token_hash',
      [tokenHash]
    );
    if (result.rowCount) return false;
    const session = await query(
      'SELECT 1 FROM roshanbrand_admin_sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash]
    );
    return session.rows.length > 0;
  };
  const requireAdminAuth: express.RequestHandler = async (req, res, next) => {
    try {
      if (!(await isAdminAuthenticated(req))) {
        res.status(401).json({ error: 'Admin login required.' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  const isValidSmsSecret = (providedSecret: string) => {
    const configuredSecret = process.env.SMS_SECRET || '';
    return configuredSecret.length > 0 &&
      timingSafeEqual(
        createHash('sha256').update(providedSecret).digest(),
        createHash('sha256').update(configuredSecret).digest()
      );
  };
  const createOrderLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const verifyUtrLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const orderStatusLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const smsWebhookLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) =>
      res
        .status(isValidSmsSecret(String(req.get('x-secret') || '')) ? 200 : 403)
        .json({ ok: false }),
  });
  const getCheckoutClient = () => requestTransaction.getStore()?.client;
  const recordUtrAttempt = async (
    client: import('pg').PoolClient,
    orderId: string,
    clientKey: string,
    utr: string
  ) => {
    const result = await client.query<{ failed_attempts: number; blocked_until: Date | null }>(
      `INSERT INTO verify_attempts (order_id, client_key, failed_attempts, last_utr)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (order_id, client_key) DO UPDATE SET
         failed_attempts = CASE
           WHEN verify_attempts.blocked_until IS NOT NULL
             AND verify_attempts.blocked_until <= NOW() THEN 1
           WHEN verify_attempts.last_utr = $3 THEN verify_attempts.failed_attempts
           ELSE verify_attempts.failed_attempts + 1
         END,
         blocked_until = CASE
           WHEN verify_attempts.blocked_until IS NOT NULL
             AND verify_attempts.blocked_until <= NOW() THEN NULL
           WHEN verify_attempts.last_utr = $3 THEN verify_attempts.blocked_until
           WHEN verify_attempts.failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '10 minutes'
           ELSE verify_attempts.blocked_until
         END,
         last_utr = $3
       RETURNING failed_attempts, blocked_until`,
      [orderId, clientKey, utr]
    );
    return result.rows[0];
  };
  const commitCheckoutTransaction = async () => {
    const transaction = requestTransaction.getStore();
    if (transaction && !transaction.committed) {
      await transaction.client.query('COMMIT');
      transaction.committed = true;
    }
  };

  app.post('/api/create-order', createOrderLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const client = getCheckoutClient();
    if (!postgresPool || !client) {
      res.status(503).json({ error: 'Payment database is not configured.' });
      return;
    }

    const upiId = String(process.env.UPI_ID || '').trim().toLowerCase();
    const payeeName = String(process.env.PAYEE_NAME || '').trim();
    if (
      !upiId ||
      !payeeName ||
      !LIMITS.UPI_ID_REGEX.test(upiId) ||
      payeeName.length < 2 ||
      payeeName.length > LIMITS.PAYEE_NAME_MAX
    ) {
      res.status(503).json({ error: 'UPI_ID and PAYEE_NAME must be configured on the server.' });
      return;
    }

    const body = req.body || {};
    const product = String(body.product || '');
    const quantity = Number(body.quantity);
    if (
      !isPackType(product) ||
      !Number.isInteger(quantity) ||
      quantity < LIMITS.QUANTITY_MIN ||
      quantity > LIMITS.QUANTITY_MAX
    ) {
      res.status(400).json({ error: 'Invalid product or quantity.' });
      return;
    }

    let unitPrice: number;
    switch (product) {
      case 'pack_1':
        if (quantity !== 1) {
          res.status(400).json({ error: 'The 1-ID package requires quantity 1.' });
          return;
        }
        unitPrice = db.storeConfig.price1Id;
        break;
      case 'pack_2':
        if (quantity !== 2) {
          res.status(400).json({ error: 'The 2-ID package requires quantity 2.' });
          return;
        }
        unitPrice = db.storeConfig.price2Id / quantity;
        break;
      case 'pack_5':
        if (quantity !== 5) {
          res.status(400).json({ error: 'The 5-ID package requires quantity 5.' });
          return;
        }
        unitPrice = db.storeConfig.price5Id / quantity;
        break;
      case 'pack_10':
        if (quantity !== 10) {
          res.status(400).json({ error: 'The 10-ID package requires quantity 10.' });
          return;
        }
        unitPrice = db.storeConfig.price10Id / quantity;
        break;
      case 'bulk':
        unitPrice = db.storeConfig.priceBulkPerId;
        break;
      case 'custom':
        unitPrice = db.storeConfig.priceCustomPerId;
        break;
      case 'rental_24h':
        unitPrice = db.storeConfig.priceRental24h;
        break;
      case 'guarantee_7days':
        unitPrice = db.storeConfig.price7DayGuaranteePerId;
        break;
      case 'guarantee_1month':
        unitPrice = db.storeConfig.price1MonthGuaranteePerId;
        break;
    }
    const amountRupees = Math.round(unitPrice * quantity);
    if (!Number.isSafeInteger(amountRupees) || amountRupees < 1 || amountRupees > 5_000_000) {
      res.status(400).json({ error: 'Order total is outside the allowed range.' });
      return;
    }

    const isRental24h = product === 'rental_24h';
    const availableStock =
      isRental24h
        ? db.storeConfig.rentalStockDisplayAvailable
        : product === 'guarantee_7days'
          ? db.storeConfig.stock7DayGuaranteeAvailable
          : product === 'guarantee_1month'
            ? db.storeConfig.stock1MonthGuaranteeAvailable
            : db.storeConfig.stockDisplayAvailable;
    const targetPool = getVaultPoolForPackType(product);
    const availableVaultItems = db.vault.filter(
      (item) =>
        !item.isAssigned &&
        item.poolType === targetPool &&
        !item.reservedOrderId
    );
    if (quantity > availableVaultItems.length || quantity > availableStock) {
      res.status(409).json({ error: 'Not enough stock is available for this package.' });
      return;
    }

    const orderId = `RB_${Date.now()}_${randomBytes(6).toString('hex').toUpperCase()}`;
    const accessToken = randomBytes(32).toString('hex');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
    const packLabel = String(body.packLabel || `${quantity} ${product} ID Pack`).trim().slice(0, 80);
    const customerReference = String(body.customerReference || 'Direct UPI Buyer')
      .trim()
      .slice(0, LIMITS.CUSTOMER_REF_MAX);
    const customSpec = String(body.customSpec || '').trim().slice(0, LIMITS.CUSTOM_SPEC_MAX);
    const amountPaise = amountRupees * 100;
    const upiLink = `upi://pay?${new URLSearchParams({
      pa: upiId,
      pn: payeeName,
      am: String(amountRupees),
      cu: 'INR',
      tn: orderId,
    }).toString()}`;

    try {
      await client.query(
        `INSERT INTO orders
          (id, product, quantity, amount_paise, status, created_at, expires_at,
           pack_label, customer_reference, custom_spec)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9)`,
        [orderId, product, quantity, amountPaise, createdAt, expiresAt, packLabel, customerReference, customSpec]
      );
      for (const item of availableVaultItems.slice(0, quantity)) {
        item.reservedOrderId = orderId;
        item.updatedAt = createdAt.toISOString();
      }
      syncVaultDisplayCounter(targetPool);
      db.orderAccessTokens[orderId] = createHash('sha256').update(accessToken).digest('hex');
      db.orders.unshift({
        orderId,
        packLabel,
        packType: product,
        isRental24h,
        rentalDurationHours: isRental24h ? 24 : undefined,
        quantity,
        unitPrice: amountRupees / quantity,
        totalAmount: amountRupees,
        paymentUpiId: upiId,
        utrNumber: '',
        upiAppUsed: 'UPI QR',
        customerReference,
        customSpec,
        status: 'pending_verification',
        paymentStatus: 'pending',
        deliveredCredentials: '',
        adminNote: 'Awaiting payment verification.',
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      });
      await saveDb(db);
      broadcastStateUpdate('vault_updated', {});
      setOrderAccessCookie(res, orderId, accessToken);
      res.status(201).json({
        orderId,
        amount: amountRupees,
        amountPaise,
        upiLink,
        upiId,
        payeeName,
        accessToken,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      console.error('Failed to create UPI order:', error);
      res.status(500).json({ error: 'The order could not be created.' });
    }
  });

  app.post('/api/sms-webhook', smsWebhookLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const providedSecret = String(req.get('x-secret') || '');
    if (!isValidSmsSecret(providedSecret)) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const sender = String(req.body?.sender || '');
    const message = String(req.body?.message || '');
    const senderKeywords = (process.env.SMS_SENDER_KEYWORDS || '')
      .split(',')
      .map((keyword) => keyword.trim().toLocaleLowerCase())
      .filter(Boolean);
    if (
      !sender ||
      !senderKeywords.some((keyword) => sender.toLocaleLowerCase().includes(keyword)) ||
      !/\b(?:credited|received)\b/i.test(message)
    ) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const amountMatch = message.match(
      /(?:₹|INR|Rs\.?)\s*((?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3}|\d+)(?:\.\d{1,2})?)/i
    );
    const utrMatch = message.match(
      /(?:UTR|REF(?:ERENCE)?|RRN)\s*(?:NO\.?|NUMBER)?\s*[:#-]?\s*(?<!\d)(\d{12})(?!\d)/i
    );
    let amountPaise: number | null = null;
    if (amountMatch) {
      const [rupeesText, fraction = ''] = amountMatch[1].replace(/,/g, '').split('.');
      try {
        const paise = BigInt(rupeesText) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
        if (paise > 0n && paise <= 2_147_483_647n) amountPaise = Number(paise);
      } catch {
        amountPaise = null;
      }
    }
    if (!amountPaise || !utrMatch) {
      console.warn('Unparsed SMS webhook message:', { sender, message });
      res.status(200).json({ ok: true, parsed: false });
      return;
    }

    const client = getCheckoutClient();
    if (!postgresPool || !client) {
      console.error('SMS payment could not be stored because the payment database is unavailable.');
      res.status(200).json({ ok: false });
      return;
    }
    try {
      await client.query(
        `INSERT INTO payments (utr, amount_paise, received_at, raw_message)
         VALUES ($1, $2, clock_timestamp(), $3)
         ON CONFLICT (utr) DO NOTHING`,
        [utrMatch[1], amountPaise, message]
      );
      await commitCheckoutTransaction();
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Failed to save SMS payment notification:', error);
      res.status(200).json({ ok: false });
    }
  });

  app.post('/api/verify-utr', verifyUtrLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const client = getCheckoutClient();
    if (!postgresPool || !client) {
      res.status(503).json({ error: 'Payment database is not configured.' });
      return;
    }
    const orderId = String(req.body?.orderId || '').trim();
    const utr = String(req.body?.utr || '').trim();
    if (!orderId || orderId.length > 100 || !LIMITS.UTR_REGEX.test(utr)) {
      res.status(400).json({ error: 'A valid order ID and 12-digit UTR are required.' });
      return;
    }

    try {
      const orderResult = await client.query<{
        id: string;
        product: PackType;
        quantity: number;
        amount_paise: number;
        status: 'pending' | 'utr_submitted' | 'paid' | 'expired' | 'rejected';
        utr: string | null;
        created_at: Date;
        expires_at: Date;
        delivered: number;
        pack_label: string;
        customer_reference: string;
        custom_spec: string;
      }>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      const paymentOrder = orderResult.rows[0];
      if (!paymentOrder) {
        res.status(404).json({ error: 'Order not found.' });
        return;
      }

      const authorizedToken = getAuthorizedOrderAccessToken(
        req,
        orderId,
        db.orderAccessTokens[orderId],
        req.body?.accessToken
      );
      if (!authorizedToken) {
        res.status(401).json({ error: 'The order access key is invalid.' });
        return;
      }
      if (paymentOrder.status === 'paid' || paymentOrder.delivered !== 0) {
        res.json({ status: 'paid' });
        return;
      }
      if (paymentOrder.status === 'rejected') {
        res.status(409).json({ error: 'This order was rejected.' });
        return;
      }
      if (paymentOrder.status === 'expired' || paymentOrder.expires_at.getTime() <= Date.now()) {
        if (paymentOrder.status !== 'expired') {
          await client.query("UPDATE orders SET status = 'expired' WHERE id = $1", [orderId]);
          for (const item of db.vault) {
            if (item.reservedOrderId === orderId) {
              item.reservedOrderId = undefined;
              item.updatedAt = new Date().toISOString();
            }
          }
          syncVaultDisplayCounter(getVaultPoolForPackType(paymentOrder.product));
          await saveDb(db);
          broadcastStateUpdate('vault_updated', {});
        }
        res.json({ status: 'expired' });
        return;
      }

      const state = { status: paymentOrder.status, delivered: paymentOrder.delivered !== 0 };
      if (paymentOrder.utr === utr && paymentOrder.status === 'utr_submitted') {
        await commitCheckoutTransaction();
        res.json({ status: 'utr_submitted' });
        return;
      }
      const clientKey = createHash('sha256').update(req.ip || 'unknown').digest('hex');
      const attemptResult = await client.query<{ blocked_until: Date | null }>(
        'SELECT blocked_until FROM verify_attempts WHERE order_id = $1 AND client_key = $2',
        [orderId, clientKey]
      );
      const blockedUntil = attemptResult.rows[0]?.blocked_until;
      if (blockedUntil && blockedUntil.getTime() > Date.now()) {
        res.setHeader('Retry-After', String(Math.ceil((blockedUntil.getTime() - Date.now()) / 1000)));
        res.status(429).json({ error: 'Too many UTR attempts. Try again in 10 minutes.' });
        return;
      }
      const duplicateUtr = await client.query<{ id: string }>(
        'SELECT id FROM orders WHERE utr = $1 AND id <> $2',
        [utr, orderId]
      );
      if (
        duplicateUtr.rows.length > 0 ||
        db.orders.some((order) => order.utrNumber === utr && order.orderId !== orderId)
      ) {
        const failed = await recordUtrAttempt(client, orderId, clientKey, utr);
        await commitCheckoutTransaction();
        if (failed?.blocked_until && failed.blocked_until.getTime() > Date.now()) {
          res.setHeader('Retry-After', String(Math.ceil((failed.blocked_until.getTime() - Date.now()) / 1000)));
          res.status(429).json({ error: 'Too many UTR attempts. Try again in 10 minutes.' });
          return;
        }
        res.status(409).json({ error: 'This UTR has already been submitted for another order.' });
        return;
      }
      const failed = await recordUtrAttempt(client, orderId, clientKey, utr);
      if (failed?.blocked_until && failed.blocked_until.getTime() > Date.now()) {
        await commitCheckoutTransaction();
        res.setHeader('Retry-After', String(Math.ceil((failed.blocked_until.getTime() - Date.now()) / 1000)));
        res.status(429).json({ error: 'Too many UTR attempts. Try again in 10 minutes.' });
        return;
      }
      if (!submitUtr(state)) {
        res.status(409).json({ error: 'This order cannot accept a UTR in its current state.' });
        return;
      }
      const submitted = await client.query(
        `UPDATE orders SET status = 'utr_submitted', utr = $2
         WHERE id = $1 AND status IN ('pending', 'utr_submitted') AND delivered = 0`,
        [orderId, utr]
      );
      if (submitted.rowCount !== 1) {
        throw new Error(`Could not submit UTR for payment order ${orderId}.`);
      }
      const order = db.orders.find((existing) => existing.orderId === orderId);
      if (order) {
        order.utrNumber = utr;
        order.paymentStatus = 'utr_submitted';
        order.updatedAt = new Date().toISOString();
      }
      await saveDb(db);
      await commitCheckoutTransaction();
      broadcastStateUpdate('order_utr_submitted', { orderId });
      res.json({ status: 'utr_submitted' });
      return;
    } catch (error) {
      console.error('Failed to submit UPI UTR:', error);
      res.status(500).json({ error: 'The UTR could not be submitted right now.' });
    }

  });

  app.get('/api/order-status/:id', orderStatusLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const client = getCheckoutClient();
    if (!postgresPool || !client) {
      res.status(503).json({ error: 'Payment database is not configured.' });
      return;
    }
    try {
      const result = await client.query<{ status: PaymentStatus }>(
        'SELECT status FROM orders WHERE id = $1',
        [req.params.id]
      );
      if (!result.rows[0]) {
        res.status(404).json({ status: 'not_found' });
        return;
      }
      res.json({ status: result.rows[0].status });
    } catch (error) {
      console.error('Failed to read payment order status:', error);
      res.status(500).json({ error: 'Order status is temporarily unavailable.' });
    }
  });

  app.use('/api/admin', (req, res, next) => {
    if (['/auth/status', '/auth/login', '/auth/recover'].includes(req.path)) {
      next();
      return;
    }
    requireAdminAuth(req, res, next);
  });

  app.get('/api/admin/auth/status', (req, res) => {
    void isAdminAuthenticated(req)
      .then((authenticated) =>
        res.json({
          configured: Boolean(adminAuth),
          authenticated,
          recoveryAvailable: Boolean(process.env.ADMIN_RECOVERY_KEY),
        })
      )
      .catch((error: unknown) => res.status(500).json({ error: 'Could not check admin session.' }));
  });

  app.post('/api/admin/auth/login', async (req, res) => {
    if (!adminAuth) {
      res.status(503).json({ error: 'Admin password is not configured on the server.' });
      return;
    }
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempt = loginFailures.get(clientKey);
    if (attempt && attempt.resetAt > now && attempt.count >= 5) {
      res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
      return;
    }

    const password = String(req.body?.password || '');
    let valid = false;
    if (password.length > 0 && password.length <= 200) {
      const actualHash = await derivePasswordHash(password, Buffer.from(adminAuth.salt, 'hex'));
      const expectedHash = Buffer.from(adminAuth.passwordHash, 'hex');
      valid = actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
    }
    if (!valid) {
      const current = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 15 * 60 * 1000 };
      current.count++;
      loginFailures.set(clientKey, current);
      res.status(401).json({ error: 'Incorrect password.' });
      return;
    }

    loginFailures.delete(clientKey);
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    if (!postgresPool) {
      fallbackAdminSessions[tokenHash] = Date.now() + sessionMaxAgeSeconds * 1000;
      persistAdminSessionStore();
    } else {
      await postgresPool.query(
        "INSERT INTO roshanbrand_admin_sessions (token_hash, expires_at) VALUES ($1, NOW() + ($2::int * INTERVAL '1 second'))",
        [tokenHash, sessionMaxAgeSeconds]
      );
    }
    res.setHeader(
      'Set-Cookie',
      `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionMaxAgeSeconds}${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''
      }`
    );
    res.json({ ok: true });
  });

  app.post('/api/admin/auth/logout', (req, res) => {
    const tokenHash = createHash('sha256').update(getSessionToken(req)).digest('hex');
    if (!postgresPool) {
      delete fallbackAdminSessions[tokenHash];
      persistAdminSessionStore();
      clearSessionCookie(res);
      res.json({ ok: true });
      return;
    }
    void postgresPool
      .query('DELETE FROM roshanbrand_admin_sessions WHERE token_hash = $1', [tokenHash])
      .then(() => {
        clearSessionCookie(res);
        res.json({ ok: true });
      })
      .catch(() => res.status(500).json({ error: 'Could not sign out the admin session.' }));
  });

  app.post('/api/admin/auth/password', async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!adminAuth) {
      res.status(503).json({ error: 'Admin password is not configured on the server.' });
      return;
    }
    const actualHash = await derivePasswordHash(
      currentPassword,
      Buffer.from(adminAuth.salt, 'hex')
    );
    const expectedHash = Buffer.from(adminAuth.passwordHash, 'hex');
    if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }
    if (newPassword.length < 10 || newPassword.length > 200) {
      res.status(400).json({ error: 'New password must be 10 to 200 characters.' });
      return;
    }
    adminAuth = await createAuthRecord(newPassword);
    persistAuthRecord(adminAuth);
    const currentSessionToken = getSessionToken(req);
    const currentSessionHash = createHash('sha256').update(currentSessionToken).digest('hex');
    if (!postgresPool) {
      for (const [tokenHash] of Object.entries(fallbackAdminSessions)) {
        if (tokenHash !== currentSessionHash) {
          delete fallbackAdminSessions[tokenHash];
        }
      }
      fallbackAdminSessions[currentSessionHash] = Date.now() + sessionMaxAgeSeconds * 1000;
      persistAdminSessionStore();
      res.json({ ok: true });
      return;
    }
    await postgresPool.query('DELETE FROM roshanbrand_admin_sessions WHERE token_hash <> $1', [
      currentSessionHash,
    ]);
    await postgresPool.query(
      `INSERT INTO roshanbrand_admin_sessions (token_hash, expires_at)
       VALUES ($1, NOW() + ($2::int * INTERVAL '1 second'))
       ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [currentSessionHash, sessionMaxAgeSeconds]
    );
    res.json({ ok: true });
  });

  app.post('/api/admin/auth/recover', async (req, res) => {
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempt = loginFailures.get(clientKey);
    if (attempt && attempt.resetAt > now && attempt.count >= 5) {
      res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
      return;
    }
    const recoveryKey = String(req.body?.recoveryKey || '');
    const configuredKey = process.env.ADMIN_RECOVERY_KEY || '';
    const suppliedDigest = createHash('sha256').update(recoveryKey).digest();
    const configuredDigest = createHash('sha256').update(configuredKey).digest();
    if (!configuredKey || !timingSafeEqual(suppliedDigest, configuredDigest)) {
      const current = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 15 * 60 * 1000 };
      current.count++;
      loginFailures.set(clientKey, current);
      res.status(401).json({ error: 'Recovery key is incorrect or not configured.' });
      return;
    }
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 10 || newPassword.length > 200) {
      res.status(400).json({ error: 'New password must be 10 to 200 characters.' });
      return;
    }
    adminAuth = await createAuthRecord(newPassword);
    persistAuthRecord(adminAuth);
    if (!postgresPool) {
      Object.keys(fallbackAdminSessions).forEach((tokenHash) => delete fallbackAdminSessions[tokenHash]);
      persistAdminSessionStore();
    } else {
      await postgresPool.query('DELETE FROM roshanbrand_admin_sessions');
    }
    loginFailures.delete(clientKey);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Real-time Server-Sent Events (SSE) stream for <50ms instant updates
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // Public Store Config
  app.get('/api/store', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const vaultStock = {
      permanent: db.vault.filter(
        (item) => item.poolType === 'permanent' && !item.isAssigned && !item.reservedOrderId
      ).length,
      rental_24h: db.vault.filter(
        (item) => item.poolType === 'rental_24h' && !item.isAssigned && !item.reservedOrderId
      ).length,
      guarantee_7days: db.vault.filter(
        (item) =>
          item.poolType === 'guarantee_7days' && !item.isAssigned && !item.reservedOrderId
      ).length,
      guarantee_1month: db.vault.filter(
        (item) =>
          item.poolType === 'guarantee_1month' && !item.isAssigned && !item.reservedOrderId
      ).length,
    };
    const storeConfig = {
      ...Object.fromEntries(
        Object.entries(db.storeConfig).filter(
          ([key]) =>
            key !== 'presetRentalCredentials' && key !== 'presetPermanentCredentials'
        )
      ),
      stockDisplayAvailable: Math.min(
        db.storeConfig.stockDisplayAvailable,
        vaultStock.permanent
      ),
      rentalStockDisplayAvailable: Math.min(
        db.storeConfig.rentalStockDisplayAvailable,
        vaultStock.rental_24h
      ),
      stock7DayGuaranteeAvailable: Math.min(
        db.storeConfig.stock7DayGuaranteeAvailable,
        vaultStock.guarantee_7days
      ),
      stock1MonthGuaranteeAvailable: Math.min(
        db.storeConfig.stock1MonthGuaranteeAvailable,
        vaultStock.guarantee_1month
      ),
      upiId: String(process.env.UPI_ID || '').trim().toLowerCase(),
      payeeName: String(process.env.PAYEE_NAME || '').trim(),
    };
    res.json({ storeConfig, vaultStock });
  });

  // Update Store Config
  app.put('/api/store', requireAdminAuth, async (req, res) => {
    const body = req.body || {};
    const upiId = String(body.upiId ?? db.storeConfig.upiId).trim();
    if (
      upiId.length < LIMITS.UPI_ID_MIN ||
      upiId.length > LIMITS.UPI_ID_MAX ||
      !LIMITS.UPI_ID_REGEX.test(upiId)
    ) {
      res.status(400).json({ error: 'Please enter a valid UPI ID.' });
      return;
    }
    const supportUrl = String(body.supportUrl ?? db.storeConfig.supportUrl).trim();
    if (normalizeSupportUrl(supportUrl, '') !== supportUrl) {
      res.status(400).json({ error: 'Please enter a valid WhatsApp link such as https://wa.me/1234567890.' });
      return;
    }
    const adminDisplayName = String(
      body.adminDisplayName ?? db.storeConfig.adminDisplayName
    ).trim();
    if (!adminDisplayName || adminDisplayName.length > 80) {
      res.status(400).json({ error: 'Admin display name must be 1 to 80 characters.' });
      return;
    }
    const maxGuaranteeReplacementsPerOrder = Number(
      body.maxGuaranteeReplacementsPerOrder ??
        db.storeConfig.maxGuaranteeReplacementsPerOrder
    );
    if (
      !Number.isInteger(maxGuaranteeReplacementsPerOrder) ||
      maxGuaranteeReplacementsPerOrder < 0 ||
      maxGuaranteeReplacementsPerOrder > 20
    ) {
      res.status(400).json({ error: 'Replacement limit must be a whole number from 0 to 20.' });
      return;
    }
    const customerPerId = Math.max(
      1,
      Math.min(100000, Math.floor(Number(body.priceCustomPerId) || 340))
    );
    const updated: StoreConfig = {
      siteTitle: String(body.siteTitle || db.storeConfig.siteTitle || 'Roshanbrand')
        .trim()
        .slice(0, LIMITS.SITE_TITLE_MAX),
      announcementText: String(
        body.announcementText ?? db.storeConfig.announcementText
      )
        .trim()
        .replace(/\s*[·•-]?\s*PAYMENT CONFIRMATION REQUIRED/gi, '')
        .trim()
        .slice(0, LIMITS.ANNOUNCEMENT_MAX),
      upiId,
      payeeName: String(
        body.payeeName || db.storeConfig.payeeName || 'Roshanbrand Official'
      )
        .trim()
        .slice(0, LIMITS.PAYEE_NAME_MAX),
      qrCodeUrl: String(body.qrCodeUrl ?? db.storeConfig.qrCodeUrl).slice(
        0,
        LIMITS.QR_URL_MAX
      ),
      supportHandle: String(body.supportHandle ?? db.storeConfig.supportHandle)
        .trim()
        .slice(0, LIMITS.SUPPORT_HANDLE_MAX),
      supportUrl,
      adminDisplayName,
      maxGuaranteeReplacementsPerOrder,
      priceCustomPerId: customerPerId,
      price1Id: customerPerId,
      price2Id: customerPerId * 2,
      price5Id: customerPerId * 5,
      price10Id: customerPerId * 10,
      priceBulkPerId: customerPerId,
      priceRental24h: normalizePrice(
        body.priceRental24h,
        db.storeConfig.priceRental24h
      ),
      price7DayGuaranteePerId: Math.max(
        1,
        Math.min(
          100000,
          Math.floor(
            Number(body.price7DayGuaranteePerId) ||
              db.storeConfig.price7DayGuaranteePerId
          )
        )
      ),
      price1MonthGuaranteePerId: Math.max(
        1,
        Math.min(
          100000,
          Math.floor(
            Number(body.price1MonthGuaranteePerId) ||
              db.storeConfig.price1MonthGuaranteePerId
          )
        )
      ),
      stockAvailable: normalizeStock(body.stockAvailable, db.storeConfig.stockAvailable),
      rentalStockAvailable: normalizeStock(
        body.rentalStockAvailable,
        db.storeConfig.rentalStockAvailable
      ),
      stockDisplayAvailable: normalizeStock(
        body.stockDisplayAvailable,
        db.storeConfig.stockDisplayAvailable
      ),
      rentalStockDisplayAvailable: normalizeStock(
        body.rentalStockDisplayAvailable,
        db.storeConfig.rentalStockDisplayAvailable
      ),
      stock7DayGuaranteeAvailable: normalizeStock(
        body.stock7DayGuaranteeAvailable,
        db.storeConfig.stock7DayGuaranteeAvailable
      ),
      stock1MonthGuaranteeAvailable: normalizeStock(
        body.stock1MonthGuaranteeAvailable,
        db.storeConfig.stock1MonthGuaranteeAvailable
      ),
      instantAutoVerify: false,
      instantDeliveryNote: DEFAULT_STORE_CONFIG.instantDeliveryNote,
      updatedAt: new Date().toISOString(),
    };

    db.storeConfig = updated;
    try {
      await saveDb(db);
    } catch {
      res.status(500).json({ error: 'Settings could not be saved to PostgreSQL.' });
      return;
    }
    broadcastStateUpdate('config_updated', { storeConfig: db.storeConfig });
    res.json({ storeConfig: db.storeConfig });
  });

  // Record submitted UTRs as pending; payment receipt must be confirmed by an admin.
  app.post('/api/orders/verify-upi', (_req, res) => {
    res.status(410).json({
      error: 'Create an order first, then submit its UTR using the order-specific checkout.',
    });
  });
  app.post('/api/orders/verify-upi', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const body = req.body || {};
    const utrNumber = String(body.utrNumber || '')
      .trim()
      .replace(/\s+/g, '');

    if (
      !LIMITS.UTR_REGEX.test(utrNumber)
    ) {
      res.status(400).json({
        error:
          'Kripya valid 12-digit numeric UPI UTR dalein.',
      });
      return;
    }

    const accessToken = String(body.accessToken || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(accessToken)) {
      res.status(400).json({ error: 'A valid private order access key is required.' });
      return;
    }

    const existingOrder = db.orders.find((order) => order.utrNumber === utrNumber);
    if (existingOrder) {
      const expectedHash = db.orderAccessTokens[existingOrder.orderId];
      const authorizedToken = getAuthorizedOrderAccessToken(
        req,
        existingOrder.orderId,
        expectedHash,
        accessToken
      );
      if (authorizedToken) {
        setOrderAccessCookie(res, existingOrder.orderId, authorizedToken);
        res.status(200).json({ order: existingOrder, accessToken: authorizedToken });
        return;
      }
      res.status(409).json({
        error:
          'Yeh UTR number pehle se submit ho chuka hai. Kripya apna UTR check karein ya Track Order me dekhein.',
      });
      return;
    }

    const quantity = Math.max(
      LIMITS.QUANTITY_MIN,
      Math.min(LIMITS.QUANTITY_MAX, Math.round(Number(body.quantity) || 1))
    );
    const packType = body.packType || (body.isRental24h ? 'rental_24h' : 'pack_1');
    if (!isPackType(packType)) {
      res.status(400).json({ error: 'Invalid package type.' });
      return;
    }

    const isRental24h = packType === 'rental_24h';
    const availableStock =
      packType === 'rental_24h'
        ? db.storeConfig.rentalStockDisplayAvailable
        : packType === 'guarantee_7days'
          ? db.storeConfig.stock7DayGuaranteeAvailable
          : packType === 'guarantee_1month'
            ? db.storeConfig.stock1MonthGuaranteeAvailable
            : db.storeConfig.stockDisplayAvailable;
    const targetPool = getVaultPoolForPackType(packType);
    const availableVaultItems = db.vault.filter(
      (item) =>
        !item.isAssigned &&
        item.poolType === targetPool &&
        !item.reservedOrderId
    );
    if (
      quantity > availableVaultItems.length ||
      quantity > availableStock
    ) {
      res.status(409).json({ error: 'Not enough stock is available for this package.' });
      return;
    }

    let totalAmount: number;
    switch (packType) {
      case 'pack_1':
        if (quantity !== 1) {
          res.status(400).json({ error: 'The 1-ID package requires quantity 1.' });
          return;
        }
        totalAmount = quantity * db.storeConfig.priceCustomPerId;
        break;
      case 'pack_2':
        if (quantity !== 2) {
          res.status(400).json({ error: 'The 2-ID package requires quantity 2.' });
          return;
        }
        totalAmount = quantity * db.storeConfig.priceCustomPerId;
        break;
      case 'pack_5':
        if (quantity !== 5) {
          res.status(400).json({ error: 'The 5-ID package requires quantity 5.' });
          return;
        }
        totalAmount = quantity * db.storeConfig.priceCustomPerId;
        break;
      case 'pack_10':
        if (quantity !== 10) {
          res.status(400).json({ error: 'The 10-ID package requires quantity 10.' });
          return;
        }
        totalAmount = quantity * db.storeConfig.priceCustomPerId;
        break;
      case 'bulk':
        totalAmount = quantity * db.storeConfig.priceCustomPerId;
        break;
      case 'custom':
        totalAmount = quantity * db.storeConfig.priceCustomPerId;
        break;
      case 'rental_24h':
        totalAmount = quantity * db.storeConfig.priceRental24h;
        break;
      case 'guarantee_7days':
        totalAmount = quantity * db.storeConfig.price7DayGuaranteePerId;
        break;
      case 'guarantee_1month':
        totalAmount = quantity * db.storeConfig.price1MonthGuaranteePerId;
        break;
    }
    if (totalAmount > 5000000) {
      res.status(400).json({ error: 'Order total exceeds the maximum allowed amount.' });
      return;
    }
    const unitPrice = Math.round(totalAmount / quantity);

    const now = new Date();
    const nowIso = now.toISOString();
    const orderId = `RB_${Date.now()}_${randomBytes(6).toString('hex').toUpperCase()}`;

    const status: OrderRecord['status'] = 'pending_verification';
    const deliveredCredentials = '';
    const paymentUpiId = db.storeConfig.upiId;
    const adminNote = `Awaiting manual confirmation of payment received at ${paymentUpiId}.`;
    const rentalExpiresAt: string | undefined = undefined;
    const verifiedAt: string | undefined = undefined;

    const newOrder: OrderRecord = {
      orderId,
      packLabel: String(
        body.packLabel ||
          (isRental24h ? '24-Hour Rental IRCTC ID' : `${quantity} IRCTC ID Pack`)
      ).slice(0, 80),
      packType,
      isRental24h,
      rentalDurationHours: isRental24h ? 24 : undefined,
      rentalExpiresAt,
      quantity,
      unitPrice,
      totalAmount,
      paymentUpiId,
      utrNumber,
      upiAppUsed: String(body.upiAppUsed || 'UPI QR').slice(0, 40),
      customerReference: String(body.customerReference || 'Direct UPI Buyer')
        .trim()
        .slice(0, LIMITS.CUSTOMER_REF_MAX),
      customSpec: String(body.customSpec || '')
        .trim()
        .slice(0, LIMITS.CUSTOM_SPEC_MAX),
      status,
      deliveredCredentials,
      adminNote,
      verifiedAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    for (const item of availableVaultItems.slice(0, quantity)) {
      item.reservedOrderId = orderId;
      item.updatedAt = nowIso;
    }
    db.orders.unshift(newOrder);
    db.orderAccessTokens[orderId] = createHash('sha256').update(accessToken).digest('hex');
    if (!(await persistDbOrRespond(res))) return;

    // Push instant <50ms notification to Admin Panel & Customer screens
    broadcastStateUpdate('order_created', { order: newOrder });

    setOrderAccessCookie(res, orderId, accessToken);
    res.status(201).json({ order: newOrder, accessToken, storeConfig: db.storeConfig });
  });

  // Lookup Order by Order ID or 12-Digit UTR Number
  app.get('/api/orders/lookup', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.status(400).json({ error: 'Please provide an Order ID or UTR number.' });
      return;
    }

    const found =
      db.orders.find((o) => o.orderId.toLowerCase() === q.toLowerCase()) ||
      db.orders.find((o) => o.utrNumber.toLowerCase() === q.toLowerCase());

    if (!found) {
      res.status(404).json({ error: 'No order found with this Order ID or UTR.' });
      return;
    }

    let paymentStatus = found.paymentStatus || 'pending';
    if (postgresPool) {
      const paymentOrder = await postgresPool.query<{ status: PaymentStatus }>(
        'SELECT status FROM orders WHERE id = $1',
        [found.orderId]
      );
      paymentStatus = paymentOrder.rows[0]?.status || 'pending';
    }

    res.json({
      order: {
        ...found,
        paymentStatus,
        utrNumber: '',
        customerReference: '',
        customSpec: '',
        deliveredCredentials: '',
        adminNote:
          found.status === 'rejected'
            ? 'Payment review could not be completed. Please contact support.'
            : '',
      },
    });
  });

  app.post('/api/orders/access', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const orderId = String(req.body?.orderId || '').trim();
    const accessToken = String(req.body?.accessToken || '').trim();
    const expectedHash = db.orderAccessTokens[orderId];

    const authorizedToken = getAuthorizedOrderAccessToken(req, orderId, expectedHash, accessToken);
    if (!authorizedToken) {
      res.status(401).json({ error: 'The order access key is invalid.' });
      return;
    }

    const order = db.orders.find((item) => item.orderId === orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (!postgresPool) {
      res.status(503).json({ error: 'Payment database is not configured.' });
      return;
    }
    const paymentOrder = await postgresPool.query<{
      status: PaymentStatus;
      delivered: number;
    }>('SELECT status, delivered FROM orders WHERE id = $1', [orderId]);
    if (paymentOrder.rows[0]?.status !== 'paid' || paymentOrder.rows[0].delivered !== 1) {
      res.status(409).json({
        error: 'Credentials are available only after an authorized payment approval.',
        status: paymentOrder.rows[0]?.status || 'pending',
      });
      return;
    }
    const rentalExpiry = getRentalExpiry(order);
    if (rentalExpiry && rentalExpiry.getTime() <= Date.now()) {
      res.json({
        order: {
          ...order,
          paymentStatus: 'paid',
          utrNumber: '',
          customerReference: '',
          customSpec: '',
          deliveredCredentials: '',
          adminNote: '',
          credentialsExpired: true,
        },
        guaranteeClaims: [],
      });
      return;
    }

    setOrderAccessCookie(res, orderId, authorizedToken);
    res.json({
      order: { ...order, paymentStatus: 'paid' },
      guaranteeClaims: db.guaranteeClaims
        .filter((claim) => claim.orderId === orderId)
        .map(toCustomerGuaranteeClaim),
    });
  });

  app.post('/api/orders/guarantee-claims', async (req, res) => {
    const orderId = String(req.body?.orderId || '').trim();
    const accessToken = String(req.body?.accessToken || '').trim();
    const expectedHash = db.orderAccessTokens[orderId];
    if (!getAuthorizedOrderAccessToken(req, orderId, expectedHash, accessToken)) {
      res.status(401).json({ error: 'The order access key is invalid.' });
      return;
    }

    const order = db.orders.find((item) => item.orderId === orderId);
    if (!order || order.status !== 'verified_delivered' || order.refundedAt) {
      res.status(409).json({ error: 'This order is not eligible for a guarantee claim.' });
      return;
    }
    const expiresAt = getGuaranteeExpiry(order);
    if (!expiresAt || Date.now() > expiresAt.getTime()) {
      res.status(409).json({ error: 'The guarantee period for this order has expired.' });
      return;
    }
    if (
      db.guaranteeClaims.some(
        (claim) =>
          claim.orderId === orderId &&
          (claim.status === 'pending' || claim.status === 'approved')
      )
    ) {
      res.status(409).json({ error: 'This order already has an open guarantee claim.' });
      return;
    }
    const credentialIndex = Number(req.body?.credentialIndex);
    const credentials = order.deliveredCredentials.split('\n').filter(Boolean);
    if (
      !Number.isInteger(credentialIndex) ||
      credentialIndex < 0 ||
      credentialIndex >= credentials.length
    ) {
      res.status(400).json({ error: 'Select a valid delivered ID for this claim.' });
      return;
    }
    const issueDescription = String(req.body?.issueDescription || '').trim();
    if (!issueDescription || issueDescription.length > 2000) {
      res.status(400).json({ error: 'Describe the issue in 1 to 2,000 characters.' });
      return;
    }
    const screenshotDataUrl = req.body?.screenshotDataUrl;
    if (screenshotDataUrl && !isValidScreenshotDataUrl(screenshotDataUrl)) {
      res.status(400).json({
        error: 'Screenshot must be a PNG, JPEG, or WebP image no larger than 1 MB.',
      });
      return;
    }

    const now = new Date().toISOString();
    const claim: GuaranteeClaim = {
      claimId: `CLM-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`,
      orderId,
      customerReference: order.customerReference,
      utrNumber: order.utrNumber,
      credentialIndex,
      oldCredential: credentials[credentialIndex],
      guaranteeType: order.packType as 'guarantee_7days' | 'guarantee_1month',
      originalPurchaseDate: (order.verifiedAt || order.createdAt),
      expiresAt: expiresAt.toISOString(),
      issueDescription,
      screenshotDataUrl: screenshotDataUrl || undefined,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      replacementHistory: [],
      actionLog: [{ action: 'claim_created', timestamp: now, adminName: 'Customer' }],
    };
    db.guaranteeClaims.unshift(claim);
    if (!(await persistDbOrRespond(res))) return;
    broadcastStateUpdate('guarantee_claim_created', { claimId: claim.claimId });
    res.status(201).json({
      claim: toCustomerGuaranteeClaim(claim),
      guaranteeClaims: db.guaranteeClaims
        .filter((item) => item.orderId === orderId)
        .map(toCustomerGuaranteeClaim),
    });
  });

  // Admin Portal State
  app.get('/api/admin/state', async (req, res) => {
    const pageSize = (key: string) => {
      const value = Number(req.query[key]);
      return Number.isInteger(value) ? Math.max(1, Math.min(500, value)) : 50;
    };
    const offset = (key: string) => {
      const value = Number(req.query[key]);
      return Number.isInteger(value) ? Math.max(0, Math.min(1000000, value)) : 0;
    };
    const orderQuery = String(req.query.orderSearch || '').trim();
    const orderStatus = String(req.query.orderStatus || 'all');
    const claimQuery = String(req.query.claimSearch || '').trim();
    const claimStatus = String(req.query.claimStatus || 'all');
    const orderOffset = offset('ordersOffset');
    const claimOffset = offset('claimsOffset');
    const ordersPageSize = pageSize('ordersLimit');
    const claimsPageSize = pageSize('claimsLimit');
    if (!postgresPool) {
      const normalizedOrders = db.orders.filter((order) => {
        if (orderStatus !== 'all' && order.status !== orderStatus) return false;
        if (!orderQuery) return true;
        const haystack = [
          order.orderId,
          order.utrNumber,
          order.customerReference,
          order.packLabel,
          order.deliveredCredentials,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(orderQuery.toLowerCase());
      });
      const normalizedClaims = db.guaranteeClaims.filter((claim) => {
        if (claimStatus !== 'all' && claim.status !== claimStatus) return false;
        if (!claimQuery) return true;
        const haystack = [
          claim.claimId,
          claim.orderId,
          claim.utrNumber,
          claim.customerReference,
          claim.oldCredential,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(claimQuery.toLowerCase());
      });
      const orders = normalizedOrders.slice(orderOffset, orderOffset + ordersPageSize);
      const claims = normalizedClaims.slice(claimOffset, claimOffset + claimsPageSize).map((claim) => ({
        ...claim,
        hasScreenshot: Boolean(claim.screenshotDataUrl),
      }));
      const summary = {
        ordersTotal: normalizedOrders.length,
        pendingOrders: db.orders.filter((order) => order.status === 'pending_verification').length,
        deliveredOrders: db.orders.filter((order) => order.status === 'verified_delivered').length,
        verifiedRevenue: db.orders
          .filter((order) => order.status === 'verified_delivered' && !order.refundedAt)
          .reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0),
      };
      const replacementCounts = Object.fromEntries(
        db.guaranteeClaims
          .map((claim) => [claim.orderId, claim.replacementHistory.length])
          .filter((entry): entry is [string, number] => Boolean(entry[0]))
      );
      res.json({
        storeConfig: db.storeConfig,
        orders,
        ordersTotal: normalizedOrders.length,
        guaranteeClaims: claims,
        guaranteeClaimsTotal: normalizedClaims.length,
        vault: db.vault,
        summary,
        replacementCounts,
        ordersOffset: orderOffset,
        claimsOffset: claimOffset,
        ordersPageSize,
        claimsPageSize,
      });
      return;
    }
    try {
      const client = requestTransaction.getStore()?.client;
      const query = client ? client.query.bind(client) : postgresPool.query.bind(postgresPool);
      const result = await query(
        `WITH app_state AS (
           SELECT state FROM roshanbrand_state WHERE id = 1
         ),
         order_rows AS (
           SELECT item, ordinal
           FROM app_state,
           jsonb_array_elements(COALESCE(state->'orders', '[]'::jsonb))
             WITH ORDINALITY AS expanded_orders(item, ordinal)
         ),
         filtered_orders AS (
           SELECT item, ordinal FROM order_rows
           WHERE ($3 = 'all' OR item->>'status' = $3)
             AND ($4 = '' OR POSITION(LOWER($4) IN LOWER(CONCAT_WS(' ',
               item->>'orderId', item->>'utrNumber', item->>'customerReference',
               item->>'packLabel', item->>'deliveredCredentials'))) > 0)
         ),
         claim_rows AS (
           SELECT item, ordinal
           FROM app_state,
           jsonb_array_elements(COALESCE(state->'guaranteeClaims', '[]'::jsonb))
             WITH ORDINALITY AS expanded_claims(item, ordinal)
         ),
         filtered_claims AS (
           SELECT item, ordinal FROM claim_rows
           WHERE ($7 = 'all' OR item->>'status' = $7)
             AND ($8 = '' OR POSITION(LOWER($8) IN LOWER(CONCAT_WS(' ',
               item->>'claimId', item->>'orderId', item->>'utrNumber',
               item->>'customerReference', item->>'oldCredential'))) > 0)
         ),
         replacement_counts AS (
           SELECT item->>'orderId' AS order_id,
             SUM(jsonb_array_length(COALESCE(item->'replacementHistory', '[]'::jsonb)))::int AS count
           FROM claim_rows
           GROUP BY item->>'orderId'
         )
         SELECT
           (SELECT state->'storeConfig' FROM app_state) AS "storeConfig",
           COALESCE((
             SELECT jsonb_agg(page.item ORDER BY page.ordinal)
             FROM (
               SELECT item, ordinal FROM filtered_orders
               ORDER BY ordinal LIMIT $2 OFFSET $1
             ) page
           ), '[]'::jsonb) AS orders,
           (SELECT COUNT(*) FROM filtered_orders)::int AS "ordersTotal",
           COALESCE((
             SELECT jsonb_agg(
               (page.item - 'screenshotDataUrl') ||
                 jsonb_build_object('hasScreenshot', page.item ? 'screenshotDataUrl')
               ORDER BY page.ordinal
             )
             FROM (
               SELECT item, ordinal FROM filtered_claims
               ORDER BY ordinal LIMIT $6 OFFSET $5
             ) page
           ), '[]'::jsonb) AS "guaranteeClaims",
           (SELECT COUNT(*) FROM filtered_claims)::int AS "guaranteeClaimsTotal",
           (SELECT state->'vault' FROM app_state) AS vault,
           jsonb_build_object(
             'ordersTotal', (SELECT COUNT(*) FROM order_rows),
             'pendingOrders', (SELECT COUNT(*) FROM order_rows WHERE item->>'status' = 'pending_verification'),
             'deliveredOrders', (SELECT COUNT(*) FROM order_rows WHERE item->>'status' = 'verified_delivered'),
             'verifiedRevenue', COALESCE((
               SELECT SUM(
                 CASE WHEN (item->>'totalAmount') ~ '^[0-9]+([.][0-9]+)?$'
                   THEN (item->>'totalAmount')::numeric ELSE 0 END
               )
               FROM order_rows
               WHERE item->>'status' = 'verified_delivered'
                 AND NOT (item ? 'refundedAt')
             ), 0)
             ) AS summary,
             COALESCE((
               SELECT jsonb_object_agg(order_id, count)
               FROM replacement_counts
             ), '{}'::jsonb) AS "replacementCounts"`,
        [
          orderOffset,
          ordersPageSize,
          orderStatus,
          orderQuery,
          claimOffset,
          claimsPageSize,
          claimStatus,
          claimQuery,
        ]
      );
      res.json({
        ...result.rows[0],
        ordersOffset: orderOffset,
        claimsOffset: claimOffset,
        ordersPageSize,
        claimsPageSize,
      });
    } catch (error) {
      console.error('Could not load paginated admin state:', error);
      res.status(500).json({ error: 'Could not load admin data.' });
    }
  });

  app.get('/api/admin/guarantee-claims/:claimId/screenshot', (req, res) => {
    const claim = db.guaranteeClaims.find((item) => item.claimId === req.params.claimId);
    if (!claim?.screenshotDataUrl) {
      res.status(404).json({ error: 'No screenshot is attached to this claim.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ screenshotDataUrl: claim.screenshotDataUrl });
  });

  app.post('/api/admin/guarantee-claims/:claimId/approve', async (req, res) => {
    const claim = db.guaranteeClaims.find((item) => item.claimId === req.params.claimId);
    if (!claim) {
      res.status(404).json({ error: 'Guarantee claim not found.' });
      return;
    }
    if (claim.status !== 'pending') {
      res.status(409).json({ error: 'Only pending claims can be approved.' });
      return;
    }
    const now = new Date().toISOString();
    claim.status = 'approved';
    claim.updatedAt = now;
    claim.actionLog.push({
      action: 'approved',
      timestamp: now,
      adminName: db.storeConfig.adminDisplayName,
    });
    if (!(await persistDbOrRespond(res))) return;
    broadcastStateUpdate('guarantee_claim_updated', { claimId: claim.claimId });
    res.json({ claim: db.guaranteeClaims.find((item) => item.claimId === claim.claimId) });
  });

  app.post('/api/admin/guarantee-claims/:claimId/reject', async (req, res) => {
    const claim = db.guaranteeClaims.find((item) => item.claimId === req.params.claimId);
    if (!claim) {
      res.status(404).json({ error: 'Guarantee claim not found.' });
      return;
    }
    if (claim.status !== 'pending' && claim.status !== 'approved') {
      res.status(409).json({ error: 'This claim is already closed.' });
      return;
    }
    const rejectionReason = String(req.body?.rejectionReason || '').trim();
    if (!rejectionReason || rejectionReason.length > 500) {
      res.status(400).json({ error: 'A rejection reason of 1 to 500 characters is required.' });
      return;
    }
    const now = new Date().toISOString();
    claim.status = 'rejected';
    claim.rejectionReason = rejectionReason;
    claim.updatedAt = now;
    claim.actionLog.push({
      action: 'rejected',
      timestamp: now,
      adminName: db.storeConfig.adminDisplayName,
      note: rejectionReason,
    });
    if (!(await persistDbOrRespond(res))) return;
    broadcastStateUpdate('guarantee_claim_updated', { claimId: claim.claimId });
    res.json({ claim });
  });

  app.post('/api/admin/guarantee-claims/:claimId/replace', async (req, res) => {
    const claim = db.guaranteeClaims.find((item) => item.claimId === req.params.claimId);
    if (!claim) {
      res.status(404).json({ error: 'Guarantee claim not found.' });
      return;
    }
    if (claim.status !== 'approved') {
      res.status(409).json({ error: 'Approve this claim before issuing a replacement.' });
      return;
    }
    const order = db.orders.find((item) => item.orderId === claim.orderId);
    if (!order || order.refundedAt) {
      res.status(409).json({ error: 'This order is not available for replacement.' });
      return;
    }
    const replacementCount = db.guaranteeClaims
      .filter((item) => item.orderId === order.orderId)
      .reduce((count, item) => count + item.replacementHistory.length, 0);
    if (replacementCount >= db.storeConfig.maxGuaranteeReplacementsPerOrder) {
      res.status(409).json({ error: 'Replacement limit reached.' });
      return;
    }
    const poolType = claim.guaranteeType;
    const availableItem = db.vault.find(
      (item) => item.poolType === poolType && !item.isAssigned && !item.reservedOrderId
    );
    if (!availableItem) {
      claim.status = 'pending';
      claim.updatedAt = new Date().toISOString();
      if (!(await persistDbOrRespond(res))) return;
      res.status(409).json({
        error: `No available IDs in the ${poolType === 'guarantee_7days' ? '7-day' : '1-month'} pool. Please add stock to resolve this claim.`,
      });
      return;
    }
    const credentials = order.deliveredCredentials.split('\n').filter(Boolean);
    if (claim.credentialIndex < 0 || claim.credentialIndex >= credentials.length) {
      res.status(409).json({ error: 'The original ID for this claim could not be found.' });
      return;
    }

    const oldCredential = credentials[claim.credentialIndex];
    if (oldCredential !== claim.oldCredential) {
      res.status(409).json({
        error: 'The delivered ID changed after this claim was created. Refresh the order before resolving it.',
      });
      return;
    }
    const oldUsername = (oldCredential.split(/[|:,]/)[0] || '')
      .replace(/^Username:\s*/i, '')
      .trim();
    const oldVaultItem = db.vault.find(
      (item) =>
        item.poolType === poolType &&
        item.assignedOrderId === order.orderId &&
        item.irctcUsername === oldUsername
    );
    if (!oldVaultItem) {
      res.status(409).json({
        error: 'The original account could not be matched to this order in the vault.',
      });
      return;
    }
    const replacementCredential = `Username: ${availableItem.irctcUsername} | Password: ${availableItem.irctcPassword}${
      availableItem.accountNote ? ` | ${availableItem.accountNote}` : ''
    }`;
    const now = new Date().toISOString();
    const adminName = db.storeConfig.adminDisplayName;
    oldVaultItem.accountNote = `${oldVaultItem.accountNote} · Replaced/Faulty`
      .trim()
      .slice(0, 160);
    oldVaultItem.updatedAt = now;
    availableItem.isAssigned = true;
    availableItem.assignedOrderId = order.orderId;
    availableItem.reservedOrderId = undefined;
    availableItem.updatedAt = now;
    credentials[claim.credentialIndex] = replacementCredential;
    order.deliveredCredentials = credentials.join('\n');
    order.updatedAt = now;
    claim.status = 'resolved';
    claim.resolution = 'replacement';
    claim.updatedAt = now;
    claim.replacementHistory.push({
      oldCredential,
      newCredential: replacementCredential,
      replacedAt: now,
      adminName,
    });
    claim.actionLog.push({
      action: 'replaced',
      timestamp: now,
      adminName,
      note: `Replaced account ${claim.credentialIndex + 1}; original expiry ${claim.expiresAt}.`,
    });
    if (!(await persistDbOrRespond(res))) return;
    broadcastStateUpdate('guarantee_claim_replaced', { claimId: claim.claimId, orderId: order.orderId });
    res.json({ claim, order });
  });

  app.post('/api/admin/guarantee-claims/:claimId/refund', async (req, res) => {
    const claim = db.guaranteeClaims.find((item) => item.claimId === req.params.claimId);
    if (!claim) {
      res.status(404).json({ error: 'Guarantee claim not found.' });
      return;
    }
    if (claim.status !== 'approved') {
      res.status(409).json({ error: 'Approve this claim before issuing a refund.' });
      return;
    }
    if (req.body?.refundConfirmed !== true) {
      res.status(400).json({
        error: 'Confirm that the payment-provider refund has been sent before recording it.',
      });
      return;
    }
    const order = db.orders.find((item) => item.orderId === claim.orderId);
    if (!order || order.refundedAt) {
      res.status(409).json({ error: 'This order has already been refunded or was not found.' });
      return;
    }
    const now = new Date().toISOString();
    const adminName = db.storeConfig.adminDisplayName;
    order.refundedAt = now;
    order.refundReason = `Guarantee claim ${claim.claimId}`;
    order.updatedAt = now;
    claim.status = 'resolved';
    claim.resolution = 'refund';
    claim.updatedAt = now;
    claim.actionLog.push({
      action: 'refunded',
      timestamp: now,
      adminName,
      note: `External refund confirmed by admin for order ${order.orderId}.`,
    });
    if (!(await persistDbOrRespond(res))) return;
    broadcastStateUpdate('guarantee_claim_refunded', { claimId: claim.claimId, orderId: order.orderId });
    res.json({ claim, order });
  });

  app.post('/api/admin/mark-paid', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const client = getCheckoutClient();
    const orderId = String(req.body?.orderId || '').trim();
    if (!postgresPool || !client) {
      res.status(503).json({ error: 'Payment database is not configured.' });
      return;
    }
    if (!orderId || orderId.length > 100) {
      res.status(400).json({ error: 'A valid order ID is required.' });
      return;
    }

    try {
      let paymentOrderResult = await client.query<{
        id: string;
        product: PackType;
        quantity: number;
        amount_paise: number;
        status: 'pending' | 'utr_submitted' | 'paid' | 'expired' | 'rejected';
        utr: string | null;
        created_at: Date;
        expires_at: Date;
        delivered: number;
        pack_label: string;
        customer_reference: string;
        custom_spec: string;
      }>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      let paymentOrder = paymentOrderResult.rows[0];
      let order = db.orders.find((existing) => existing.orderId === orderId);

      if (!paymentOrder) {
        if (!order) {
          res.status(404).json({ error: 'Order not found.' });
          return;
        }
        if (order.status === 'rejected') {
          res.status(409).json({ error: 'Rejected orders cannot be manually marked as paid.' });
          return;
        }
        if (!isPackType(order.packType)) {
          res.status(409).json({ error: 'Order has an invalid product type.' });
          return;
        }
        const amountPaise = Math.round(order.totalAmount * 100);
        const createdAt = new Date(order.createdAt);
        if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || !Number.isFinite(createdAt.getTime())) {
          res.status(409).json({ error: 'Order payment details are invalid.' });
          return;
        }
        const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
        const status =
          order.status === 'verified_delivered'
            ? 'paid'
            : expiresAt.getTime() <= Date.now()
              ? 'expired'
              : 'pending';
        await client.query(
          `INSERT INTO orders
            (id, product, quantity, amount_paise, status, utr, created_at, expires_at,
             delivered, pack_label, customer_reference, custom_spec)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO NOTHING`,
          [
            orderId,
            order.packType,
            order.quantity,
            amountPaise,
            status,
            order.utrNumber || null,
            createdAt,
            expiresAt,
            order.status === 'verified_delivered' ? 1 : 0,
            order.packLabel,
            order.customerReference,
            order.customSpec,
          ]
        );
        paymentOrderResult = await client.query(
          'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
          [orderId]
        );
        paymentOrder = paymentOrderResult.rows[0];
      }

      if (!paymentOrder) {
        throw new Error(`Could not load payment order ${orderId} after creating its record.`);
      }

      if (paymentOrder.status === 'rejected') {
        res.status(409).json({ error: 'Rejected orders cannot be manually marked as paid.' });
        return;
      }

      await client.query(
        "INSERT INTO manual_payment_logs (order_id, source) VALUES ($1, 'manual')",
        [orderId]
      );

      if (paymentOrder.delivered !== 0) {
        await commitCheckoutTransaction();
        res.json({ status: 'paid', alreadyDelivered: true });
        return;
      }

      if (order?.status === 'rejected') {
        res.status(409).json({ error: 'Rejected orders cannot be manually marked as paid.' });
        return;
      }

      if (!order) {
        const now = new Date().toISOString();
        order = {
          orderId,
          packLabel: paymentOrder.pack_label,
          packType: paymentOrder.product,
          isRental24h: paymentOrder.product === 'rental_24h',
          rentalDurationHours: paymentOrder.product === 'rental_24h' ? 24 : undefined,
          quantity: paymentOrder.quantity,
          unitPrice: paymentOrder.amount_paise / 100 / paymentOrder.quantity,
          totalAmount: paymentOrder.amount_paise / 100,
          paymentUpiId: process.env.UPI_ID,
          utrNumber: paymentOrder.utr || '',
          upiAppUsed: 'UPI QR',
          customerReference: paymentOrder.customer_reference,
          customSpec: paymentOrder.custom_spec,
          status: 'pending_verification',
          deliveredCredentials: '',
          adminNote: 'Awaiting payment verification.',
          createdAt: paymentOrder.created_at.toISOString(),
          updatedAt: now,
        };
      }

      const verifiedOrderId = order.utrNumber ? db.utrIndex[order.utrNumber] : undefined;
      if (verifiedOrderId && verifiedOrderId !== orderId) {
        res.status(409).json({ error: 'This UTR has already been used for another order.' });
        return;
      }

      const deliveryState = { delivered: paymentOrder.delivered !== 0, status: paymentOrder.status };
      const requestedCredentials = String(req.body?.deliveredCredentials || '').trim();
      const deliveryResult = deliverOnce(deliveryState, 'manual', () =>
        deliverOrder(order!, requestedCredentials)
      );
      if (deliveryResult === 'already-delivered') {
        await commitCheckoutTransaction();
        res.json({ status: deliveryState.status, alreadyDelivered: true });
        return;
      }
      if (deliveryResult === 'unavailable') {
        await commitCheckoutTransaction();
        res.status(409).json({
          error: 'Not enough available IDs in the matching vault pool to deliver this order.',
        });
        return;
      }

      const updated = await client.query(
        "UPDATE orders SET status = 'paid', delivered = 1, utr = COALESCE(utr, $2) WHERE id = $1 AND delivered = 0",
        [orderId, order.utrNumber || null]
      );
      if (updated.rowCount !== 1) {
        throw new Error(`Payment order ${orderId} was delivered by another transaction.`);
      }
      if (order.utrNumber) {
        await client.query(
          'UPDATE payments SET used_order_id = $2 WHERE utr = $1 AND used_order_id IS NULL',
          [order.utrNumber, orderId]
        );
        await client.query('DELETE FROM verify_attempts WHERE order_id = $1', [orderId]);
      }
      syncVaultDisplayCounter(getVaultPoolForPackType(order.packType));
      await saveDb(db);
      broadcastStateUpdate('order_verified', { order, source: 'manual' });
      broadcastStateUpdate('vault_updated', {});
      res.json({ status: 'paid', alreadyDelivered: false, order });
    } catch (error) {
      console.error('Failed to manually mark UPI order as paid:', error);
      res.status(500).json({ error: 'The order could not be marked paid.' });
    }
  });

  // Admin 1-Click Verify / Update Order Credentials (Automatically uses Ready ID Vault if not manually overridden)
  app.post('/api/admin/orders/:orderId/verify', (_req, res) => {
    res.status(409).json({
      error: 'Use the authenticated mark-paid action to approve payment and deliver this order.',
    });
  });
  app.post('/api/admin/orders/:orderId/verify', async (req, res) => {
    const { orderId } = req.params;
    const order = db.orders.find((o) => o.orderId === orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    if (order.status === 'rejected') {
      res.status(409).json({
        error: 'Rejected orders cannot be delivered. Create a new order after confirming payment.',
      });
      return;
    }
    const verifiedOrderId = db.utrIndex[order.utrNumber];
    if (verifiedOrderId && verifiedOrderId !== order.orderId) {
      res.status(409).json({ error: 'This UTR has already been used for a verified order.' });
      return;
    }

    let creds = String(req.body?.deliveredCredentials || '').trim();
    if (order.status === 'verified_delivered' && !creds) {
      res.status(409).json({
        error: 'This order was already delivered. Select its existing assigned credentials to update the delivery.',
      });
      return;
    }
    const targetPool = getVaultPoolForPackType(order.packType);
    if (creds) {
      const credentialLines = creds.split('\n').map((line: string) => line.trim()).filter(Boolean);
      const matchedItems = credentialLines.map((line: string) => {
        const username = (line.split(/[|:,]/)[0] || '').replace(/^Username:\s*/i, '').trim();
        return db.vault.find(
          (item) =>
            item.poolType === targetPool &&
            item.irctcUsername === username &&
            ((!item.isAssigned && (!item.reservedOrderId || item.reservedOrderId === order.orderId)) ||
              item.assignedOrderId === order.orderId)
        );
      });
      if (
        credentialLines.length !== order.quantity ||
        matchedItems.some((item) => !item) ||
        new Set(matchedItems.map((item) => item?.vaultId)).size !== order.quantity
      ) {
        res.status(409).json({
          error: `This order requires ${order.quantity} available ID(s) from the ${getVaultPoolLabel(targetPool)} pool only.`,
        });
        return;
      }
      const now = new Date().toISOString();
      const actualCredentialLines: string[] = [];
      for (const item of matchedItems) {
        if (item) {
          item.isAssigned = true;
          item.assignedOrderId = order.orderId;
          item.reservedOrderId = undefined;
          item.updatedAt = now;
          actualCredentialLines.push(
            `Username: ${item.irctcUsername} | Password: ${item.irctcPassword}${
              item.accountNote ? ` | ${item.accountNote}` : ''
            }`
          );
        }
      }
      creds = actualCredentialLines.join('\n');
    } else {
      const allocated = allocateCredentials(order.quantity, order.packType, order.orderId);
      if (allocated === null) {
        res.status(409).json({
          error: `Not enough unassigned IDs in the ${getVaultPoolLabel(targetPool)} pool. Add more IDs to that pool before delivery.`,
        });
        return;
      }
      creds = allocated;
    }

    const now = new Date();
    order.status = 'verified_delivered';
    order.deliveredCredentials = sanitizeDeliveredCredentials(creds).slice(
      0,
      LIMITS.CREDENTIALS_MAX
    );
    order.updatedAt = now.toISOString();
    order.verifiedAt = order.verifiedAt || now.toISOString();

    if (order.isRental24h && !order.rentalExpiresAt) {
      order.rentalExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }
    order.adminNote = order.isRental24h
      ? `Admin Verified UTR #${order.utrNumber} · Ready Vault 24H Rental ID Sent`
      : `Admin Verified UTR #${order.utrNumber} · Ready Vault ID Sent`;

    db.utrIndex[order.utrNumber] = order.orderId;
    if (!(await persistDbOrRespond(res))) return;
    broadcastStateUpdate('order_verified', { order });
    res.json({ order, storeConfig: db.storeConfig });
  });

  // Admin Reject Order
  app.post('/api/admin/orders/:orderId/reject', async (req, res) => {
    const { orderId } = req.params;
    const order = db.orders.find((o) => o.orderId === orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    if (order.status !== 'pending_verification') {
      res.status(409).json({
        error: 'Only orders awaiting payment review can be rejected.',
      });
      return;
    }

    if (postgresPool) {
      await postgresPool.query(
        "UPDATE orders SET status = 'rejected' WHERE id = $1 AND delivered = 0 AND status <> 'paid'",
        [order.orderId]
      );
    }
    order.status = 'rejected';
    order.paymentStatus = 'rejected';
    order.adminNote =
      'Payment UTR could not be verified. Please contact support with payment screenshot.';
    order.updatedAt = new Date().toISOString();
    for (const item of db.vault) {
      if (item.reservedOrderId === order.orderId) {
        item.reservedOrderId = undefined;
        item.updatedAt = order.updatedAt;
      }
    }
    if (!(await persistDbOrRespond(res))) return;
    broadcastStateUpdate('order_rejected', { order });

    res.json({ order });
  });

  // Admin Delete Order
  app.delete('/api/admin/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const idx = db.orders.findIndex((o) => o.orderId === orderId);
    if (idx !== -1) {
      const deletedOrder = db.orders[idx];
      if (
        deletedOrder.status === 'verified_delivered' ||
        db.guaranteeClaims.some((claim) => claim.orderId === orderId)
      ) {
        res.status(409).json({
          error: 'Delivered or claimed orders cannot be deleted; keep the order and audit history.',
        });
        return;
      }
      for (const item of db.vault) {
        if (item.reservedOrderId === deletedOrder.orderId) {
          item.reservedOrderId = undefined;
          item.updatedAt = new Date().toISOString();
        }
      }
      const [removed] = db.orders.splice(idx, 1);
      if (removed && db.utrIndex[removed.utrNumber] === orderId) {
        delete db.utrIndex[removed.utrNumber];
      }
      delete db.orderAccessTokens[orderId];
      if (!(await persistDbOrRespond(res))) return;
      broadcastStateUpdate('order_deleted', { orderId });
    }
    res.json({ ok: true });
  });

  // Admin Add Vault Items
  app.post('/api/admin/vault', async (req, res) => {
    const lines: unknown[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const batchNote = String(req.body?.accountNote || '').trim();
    const poolTypes: VaultPoolType[] = [
      'permanent',
      'rental_24h',
      'guarantee_7days',
      'guarantee_1month',
    ];
    const requestedPoolType = req.body?.poolType;
    if (
      requestedPoolType !== undefined &&
      !poolTypes.includes(requestedPoolType as VaultPoolType)
    ) {
      res.status(400).json({ error: 'Invalid vault pool type.' });
      return;
    }
    const poolType: VaultPoolType =
      requestedPoolType === undefined
        ? 'permanent'
        : (requestedPoolType as VaultPoolType);

    if (lines.length === 0 || lines.length > 500) {
      res.status(400).json({ error: 'Provide between 1 and 500 credential lines.' });
      return;
    }
    const parsedLines: { username: string; password: string; extraNote: string }[] = [];
    const usernames = new Set(db.vault.map((item) => item.irctcUsername.toLowerCase()));
    for (const [index, rawLine] of lines.entries()) {
      const line = typeof rawLine === 'string' ? rawLine.trim() : '';
      if (!line) continue;
      const parts = line.split('|').map((part) => part.trim());
      const username = parts[0] || '';
      const password = parts[1] || '';
      if (
        parts.length < 2 ||
        !username ||
        username.length > 80 ||
        !/^[a-zA-Z0-9_-]+$/.test(username) ||
        password.length < 2 ||
        password.length > 80
      ) {
        res.status(400).json({
          error: `Credential line ${index + 1} must contain a valid username and password separated by "|".`,
        });
        return;
      }
      if (usernames.has(username.toLowerCase())) {
        res.status(409).json({
          error: `Username on line ${index + 1} already exists in the vault.`,
        });
        return;
      }
      usernames.add(username.toLowerCase());
      parsedLines.push({
        username,
        password,
        extraNote: sanitizeVaultNote(parts.slice(2).join(' | ')),
      });
    }
    if (parsedLines.length === 0) {
      res.status(400).json({ error: 'No valid credential lines were provided.' });
      return;
    }

    const now = new Date().toISOString();
    for (const { username, password, extraNote } of parsedLines) {
      const combinedNote = [
        sanitizeVaultNote(batchNote),
        extraNote,
        poolType === 'rental_24h'
          ? '24H Active Rental'
          : poolType === 'guarantee_7days'
            ? '7 Days Guarantee'
            : poolType === 'guarantee_1month'
              ? '1 Month Guarantee'
              : 'Aadhaar Verified',
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 160);

      const vaultId = `VAULT_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;

      db.vault.unshift({
        vaultId,
        irctcUsername: username,
        irctcPassword: password,
        accountNote: combinedNote,
        poolType,
        isAssigned: false,
        assignedOrderId: '',
        createdAt: now,
        updatedAt: now,
      });
    }

    syncVaultDisplayCounter(poolType);
    if (poolType === 'rental_24h') {
      db.storeConfig.rentalStockAvailable += parsedLines.length;
    } else if (poolType === 'permanent') {
      db.storeConfig.stockAvailable += parsedLines.length;
    }
    if (!(await persistDbOrRespond(res))) return;
    broadcastStateUpdate('vault_updated', {});

    res.status(201).json({ addedCount: parsedLines.length, storeConfig: db.storeConfig });
  });

  // Admin Delete Vault Item
  app.delete('/api/admin/vault/:vaultId', async (req, res) => {
    const { vaultId } = req.params;
    const idx = db.vault.findIndex((v) => v.vaultId === vaultId);
    if (idx !== -1) {
      const poolType = db.vault[idx].poolType;
      db.vault.splice(idx, 1);
      syncVaultDisplayCounter(poolType);
      if (!(await persistDbOrRespond(res))) return;
      broadcastStateUpdate('vault_updated', {});
    }
    res.json({ ok: true });
  });

  const expirePendingPaymentOrders = async () => {
    if (!postgresPool) return;
    const client = await postgresPool.connect();
    try {
      await client.query('BEGIN');
      const stateResult = await client.query<{ state: PersistedDatabase }>(
        'SELECT state FROM roshanbrand_state WHERE id = 1 FOR UPDATE'
      );
      if (!stateResult.rows[0]) throw new Error('Persistent application state is missing.');
      Object.assign(db, stateResult.rows[0].state);
      db.orderAccessTokens ||= {};
      db.guaranteeClaims ||= [];

      const expiredResult = await client.query<{ id: string; product: PackType }>(
        `UPDATE orders SET status = 'expired'
         WHERE status IN ('pending', 'utr_submitted') AND expires_at <= NOW()
         RETURNING id, product`
      );
      if (expiredResult.rowCount) {
        const expiredIds = new Set(expiredResult.rows.map((row) => row.id));
        const expiredPools = new Set(
          expiredResult.rows.map((row) => getVaultPoolForPackType(row.product))
        );
        const now = new Date().toISOString();
        for (const item of db.vault) {
          if (item.reservedOrderId && expiredIds.has(item.reservedOrderId)) {
            item.reservedOrderId = undefined;
            item.updatedAt = now;
          }
        }
        for (const pool of expiredPools) syncVaultDisplayCounter(pool);
        const state = JSON.stringify(db);
        await client.query(
          'UPDATE roshanbrand_state SET state = $1::jsonb, updated_at = NOW() WHERE id = 1',
          [state]
        );
        await client.query('COMMIT');
        lastPersistedState = state;
        broadcastStateUpdate('orders_expired', { count: expiredResult.rowCount });
        broadcastStateUpdate('vault_updated', {});
      } else {
        await client.query('COMMIT');
      }
    } catch (error) {
      await client.query('ROLLBACK').catch((rollbackError: unknown) => {
        console.error('Failed to rollback order-expiry transaction:', rollbackError);
      });
      throw error;
    } finally {
      client.release();
    }
  };
  const expiryTimer = setInterval(() => {
    void expirePendingPaymentOrders().catch((error: unknown) => {
      console.error('Failed to expire pending payment orders:', error);
    });
  }, 60_000);
  expiryTimer.unref();

  // Vite Middleware (Development) or Static Dist (Production)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Roshanbrand server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(async (error: unknown) => {
  console.error('Failed to start server:', error);
  if (postgresPool) {
    await postgresPool.end();
  }
  process.exitCode = 1;
});
