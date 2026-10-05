import express from 'express';
import 'dotenv/config';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_STORE_CONFIG, LIMITS } from './src/constants.ts';
import { OrderRecord, PackType, StoreConfig, VaultItem, VaultPoolType } from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const DATA_FILE = path.join(DATA_DIR, 'roshanbrand_store.json');
const SEED_DATA_FILE = path.join(DEFAULT_DATA_DIR, 'roshanbrand_store.json');
const ADMIN_AUTH_FILE = path.join(DATA_DIR, 'admin_auth.json');

interface AdminAuthRecord {
  salt: string;
  passwordHash: string;
}

interface PersistedDatabase {
  storeConfig: StoreConfig;
  orders: OrderRecord[];
  vault: VaultItem[];
  utrIndex: Record<string, string>;
}

function buildInitialVault(): VaultItem[] {
  const now = new Date().toISOString();
  const rentalAccounts = [
    { u: 'roshan_rent24_101', p: 'Tatkal@2491', note: '24H Active Rental · Aadhaar Verified' },
    { u: 'roshan_rent24_102', p: 'Tatkal@2492', note: '24H Active Rental · Aadhaar Verified' },
    { u: 'roshan_rent24_103', p: 'Tatkal@2493', note: '24H Active Rental · Aadhaar Verified' },
    { u: 'roshan_rent24_104', p: 'Tatkal@2494', note: '24H Active Rental · Aadhaar Verified' },
    { u: 'roshan_rent24_105', p: 'Tatkal@2495', note: '24H Active Rental · Aadhaar Verified' },
    { u: 'roshan_rent24_106', p: 'Tatkal@2496', note: '24H Active Rental · Aadhaar Verified' },
  ];

  const permanentAccounts = [
    { u: 'rb_irctc_vip801', p: 'RailPass@801', note: 'Permanent Aadhaar Verified' },
    { u: 'rb_irctc_vip802', p: 'RailPass@802', note: 'Permanent Aadhaar Verified' },
    { u: 'rb_irctc_vip803', p: 'RailPass@803', note: 'Permanent Aadhaar Verified' },
    { u: 'rb_irctc_vip804', p: 'RailPass@804', note: 'Permanent Aadhaar Verified' },
  ];

  const items: VaultItem[] = [];

  rentalAccounts.forEach((acc, i) => {
    items.push({
      vaultId: `VAULT_RENT_${1000 + i}`,
      irctcUsername: acc.u,
      irctcPassword: acc.p,
      accountNote: acc.note,
      poolType: 'rental_24h',
      isAssigned: false,
      assignedOrderId: '',
      createdAt: now,
      updatedAt: now,
    });
  });

  permanentAccounts.forEach((acc, i) => {
    items.push({
      vaultId: `VAULT_PERM_${2000 + i}`,
      irctcUsername: acc.u,
      irctcPassword: acc.p,
      accountNote: acc.note,
      poolType: 'permanent',
      isAssigned: false,
      assignedOrderId: '',
      createdAt: now,
      updatedAt: now,
    });
  });

  return items;
}

function loadDb(): PersistedDatabase {
  const sourceFile = fs.existsSync(DATA_FILE) ? DATA_FILE : SEED_DATA_FILE;
  if (fs.existsSync(sourceFile)) {
    try {
      const raw = fs.readFileSync(sourceFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedDatabase>;
      const savedStoreConfig: Partial<StoreConfig> = parsed.storeConfig || {};
      const orders = Array.isArray(parsed.orders) ? parsed.orders : [];
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
          presetRentalCredentials: sanitizeDeliveredCredentials(
            savedStoreConfig.presetRentalCredentials ||
              DEFAULT_STORE_CONFIG.presetRentalCredentials ||
              ''
          ),
          presetPermanentCredentials: sanitizeDeliveredCredentials(
            savedStoreConfig.presetPermanentCredentials ||
              DEFAULT_STORE_CONFIG.presetPermanentCredentials ||
              ''
          ),
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
  };
}

function saveDb(db: PersistedDatabase) {
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(temporaryFile, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(temporaryFile, DATA_FILE);
  } catch (err) {
    try {
      if (fs.existsSync(temporaryFile)) {
        fs.unlinkSync(temporaryFile);
      }
    } catch (cleanupError) {
      console.error('Failed to remove temporary store data file:', cleanupError);
    }
    console.error('Failed to persist store data:', err);
    throw err;
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

function normalizeUpiId(value: unknown, fallback: string): string {
  const upiId = String(value ?? '').trim();
  return upiId.length >= LIMITS.UPI_ID_MIN &&
    upiId.length <= LIMITS.UPI_ID_MAX &&
    LIMITS.UPI_ID_REGEX.test(upiId)
    ? upiId
    : fallback;
}

function getVaultPoolForPackType(packType: PackType): VaultPoolType {
  if (packType === 'rental_24h') return 'rental_24h';
  if (packType === 'guarantee_7days') return 'guarantee_7days';
  if (packType === 'guarantee_1month') return 'guarantee_1month';
  return 'permanent';
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
saveDb(db);

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
 * Pulls credentials from Ready ID Vault:
 * 1. First checks unassigned items in the Ready ID Vault matching the pool ('rental_24h' or 'permanent').
 * 2. Next uses the Admin's Pre-Set Master Ready ID (presetRentalCredentials / presetPermanentCredentials)
 *    or any Vault items set by the Admin so customers ALWAYS get the Admin's pre-configured Ready Vault ID!
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

/**
 * Preview what credentials will be used for an order from Ready Vault without mutating state yet.
 */
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '2mb' }));

  const sessions = new Map<string, number>();
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
  const isAdminAuthenticated = (req: express.Request) => {
    const token = getSessionToken(req);
    const expiresAt = sessions.get(token);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  };
  const requireAdminAuth: express.RequestHandler = (req, res, next) => {
    if (!isAdminAuthenticated(req)) {
      res.status(401).json({ error: 'Admin login required.' });
      return;
    }
    next();
  };

  app.use('/api/admin', (req, res, next) => {
    if (['/auth/status', '/auth/login', '/auth/recover'].includes(req.path)) {
      next();
      return;
    }
    requireAdminAuth(req, res, next);
  });

  app.get('/api/admin/auth/status', (req, res) => {
    res.json({
      configured: Boolean(adminAuth),
      authenticated: isAdminAuthenticated(req),
      recoveryAvailable: Boolean(process.env.ADMIN_RECOVERY_KEY),
    });
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
    sessions.set(token, now + sessionMaxAgeSeconds * 1000);
    res.setHeader(
      'Set-Cookie',
      `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionMaxAgeSeconds}${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''
      }`
    );
    res.json({ ok: true });
  });

  app.post('/api/admin/auth/logout', (req, res) => {
    sessions.delete(getSessionToken(req));
    clearSessionCookie(res);
    res.json({ ok: true });
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
    sessions.clear();
    sessions.set(currentSessionToken, Date.now() + sessionMaxAgeSeconds * 1000);
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
    sessions.clear();
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
    res.json({ storeConfig: db.storeConfig, vaultStock });
  });

  // Update Store Config
  app.put('/api/store', requireAdminAuth, (req, res) => {
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
      presetRentalCredentials: String(
        body.presetRentalCredentials ??
          db.storeConfig.presetRentalCredentials ??
          DEFAULT_STORE_CONFIG.presetRentalCredentials
      )
        .trim()
        .slice(0, LIMITS.CREDENTIALS_MAX),
      presetPermanentCredentials: String(
        body.presetPermanentCredentials ??
          db.storeConfig.presetPermanentCredentials ??
          DEFAULT_STORE_CONFIG.presetPermanentCredentials
      )
        .trim()
        .slice(0, LIMITS.CREDENTIALS_MAX),
      instantDeliveryNote: DEFAULT_STORE_CONFIG.instantDeliveryNote,
      updatedAt: new Date().toISOString(),
    };

    const previousConfig = db.storeConfig;
    db.storeConfig = updated;
    try {
      saveDb(db);
    } catch {
      db.storeConfig = previousConfig;
      res.status(500).json({ error: 'Settings could not be saved to persistent storage.' });
      return;
    }
    broadcastStateUpdate('config_updated', { storeConfig: db.storeConfig });
    res.json({ storeConfig: db.storeConfig });
  });

  // Record submitted UTRs as pending; payment receipt must be confirmed by an admin.
  app.post('/api/orders/verify-upi', (req, res) => {
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

    if (db.utrIndex[utrNumber]) {
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
    if (quantity > availableStock || quantity > availableVaultItems.length) {
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
    const orderId = `RB_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase()}`;

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
    saveDb(db);

    // Push instant <50ms notification to Admin Panel & Customer screens
    broadcastStateUpdate('order_created', { order: newOrder });

    res.status(201).json({ order: newOrder, storeConfig: db.storeConfig });
  });

  // Lookup Order by Order ID or 12-Digit UTR Number
  app.get('/api/orders/lookup', (req, res) => {
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

    res.json({ order: found });
  });

  // Admin Portal State
  app.get('/api/admin/state', (_req, res) => {
    res.json({
      storeConfig: db.storeConfig,
      orders: db.orders,
      vault: db.vault,
    });
  });

  // Admin 1-Click Verify / Update Order Credentials (Automatically uses Ready ID Vault if not manually overridden)
  app.post('/api/admin/orders/:orderId/verify', (req, res) => {
    const { orderId } = req.params;
    const order = db.orders.find((o) => o.orderId === orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const verifiedOrderId = db.utrIndex[order.utrNumber];
    if (verifiedOrderId && verifiedOrderId !== order.orderId) {
      res.status(409).json({ error: 'This UTR has already been used for a verified order.' });
      return;
    }

    let creds = String(req.body?.deliveredCredentials || '').trim();
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
    saveDb(db);
    broadcastStateUpdate('order_verified', { order });
    res.json({ order, storeConfig: db.storeConfig });
  });

  // Admin Reject Order
  app.post('/api/admin/orders/:orderId/reject', (req, res) => {
    const { orderId } = req.params;
    const order = db.orders.find((o) => o.orderId === orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    order.status = 'rejected';
    order.adminNote =
      'Payment UTR could not be verified. Please contact support with payment screenshot.';
    order.updatedAt = new Date().toISOString();
    for (const item of db.vault) {
      if (item.reservedOrderId === order.orderId) {
        item.reservedOrderId = undefined;
        item.updatedAt = order.updatedAt;
      }
    }
    saveDb(db);
    broadcastStateUpdate('order_rejected', { order });

    res.json({ order });
  });

  // Admin Delete Order
  app.delete('/api/admin/orders/:orderId', (req, res) => {
    const { orderId } = req.params;
    const idx = db.orders.findIndex((o) => o.orderId === orderId);
    if (idx !== -1) {
      const deletedOrder = db.orders[idx];
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
      saveDb(db);
      broadcastStateUpdate('order_deleted', { orderId });
    }
    res.json({ ok: true });
  });

  // Admin Add Vault Items
  app.post('/api/admin/vault', (req, res) => {
    const lines: string[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
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

    const now = new Date().toISOString();
    let addedCount = 0;
    const formattedAddedLines: string[] = [];

    for (const rawLine of lines) {
      const line = String(rawLine).trim();
      if (!line) continue;
      const parts = line
        .split(/[|:,]/)
        .map((p) => p.trim())
        .filter(Boolean);
      const username = (parts[0] || line).slice(0, 80);
      const password = (parts[1] || 'Pass@123').slice(0, 80);
      const extraNote = sanitizeVaultNote(parts.slice(2).join(' | '));
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

      const finalUser = username.length >= 2 ? username : `id_${username}`;
      const finalPass = password.length >= 2 ? password : `pw_${password}`;

      db.vault.unshift({
        vaultId,
        irctcUsername: finalUser,
        irctcPassword: finalPass,
        accountNote: combinedNote,
        poolType,
        isAssigned: false,
        assignedOrderId: '',
        createdAt: now,
        updatedAt: now,
      });
      formattedAddedLines.push(
        `Username: ${finalUser} | Password: ${finalPass}${
          combinedNote ? ` | ${combinedNote}` : ''
        }`
      );
      addedCount++;
    }

    if (addedCount > 0) {
      if (poolType === 'rental_24h') {
        db.storeConfig.rentalStockAvailable =
          db.storeConfig.rentalStockAvailable + addedCount;
        // Also update the default Pre-Set Rental ID to the latest added ID so it's always ready!
        db.storeConfig.presetRentalCredentials = formattedAddedLines[0];
      } else if (poolType === 'permanent') {
        db.storeConfig.stockAvailable += addedCount;
        db.storeConfig.presetPermanentCredentials = formattedAddedLines[0];
      }
      saveDb(db);
      broadcastStateUpdate('vault_updated', {});
    }

    res.status(201).json({ vault: db.vault, storeConfig: db.storeConfig });
  });

  // Admin Delete Vault Item
  app.delete('/api/admin/vault/:vaultId', (req, res) => {
    const { vaultId } = req.params;
    const idx = db.vault.findIndex((v) => v.vaultId === vaultId);
    if (idx !== -1) {
      db.vault.splice(idx, 1);
      saveDb(db);
      broadcastStateUpdate('vault_updated', {});
    }
    res.json({ ok: true });
  });

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

startServer();
