import express from 'express';
import 'dotenv/config';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_STORE_CONFIG, LIMITS } from './src/constants.ts';
import { OrderRecord, StoreConfig, VaultItem } from './src/types.ts';

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
    { u: 'roshan_rent24_101', p: 'Tatkal@2491', note: '24H Active Rental · TxnPin: 4412 · Aadhaar Verified' },
    { u: 'roshan_rent24_102', p: 'Tatkal@2492', note: '24H Active Rental · TxnPin: 8821 · Aadhaar Verified' },
    { u: 'roshan_rent24_103', p: 'Tatkal@2493', note: '24H Active Rental · TxnPin: 3190 · Aadhaar Verified' },
    { u: 'roshan_rent24_104', p: 'Tatkal@2494', note: '24H Active Rental · TxnPin: 7745 · Aadhaar Verified' },
    { u: 'roshan_rent24_105', p: 'Tatkal@2495', note: '24H Active Rental · TxnPin: 5562 · Aadhaar Verified' },
    { u: 'roshan_rent24_106', p: 'Tatkal@2496', note: '24H Active Rental · TxnPin: 9014 · Aadhaar Verified' },
  ];

  const permanentAccounts = [
    { u: 'rb_irctc_vip801', p: 'RailPass@801', note: 'Permanent Aadhaar Verified · TxnPin: 1928' },
    { u: 'rb_irctc_vip802', p: 'RailPass@802', note: 'Permanent Aadhaar Verified · TxnPin: 6451' },
    { u: 'rb_irctc_vip803', p: 'RailPass@803', note: 'Permanent Aadhaar Verified · TxnPin: 7309' },
    { u: 'rb_irctc_vip804', p: 'RailPass@804', note: 'Permanent Aadhaar Verified · TxnPin: 5182' },
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
  try {
    const sourceFile = fs.existsSync(DATA_FILE) ? DATA_FILE : SEED_DATA_FILE;
    if (fs.existsSync(sourceFile)) {
      const raw = fs.readFileSync(sourceFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedDatabase>;
      return {
        storeConfig: { ...DEFAULT_STORE_CONFIG, ...(parsed.storeConfig || {}) },
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
        vault: Array.isArray(parsed.vault) ? parsed.vault : buildInitialVault(),
        utrIndex: parsed.utrIndex && typeof parsed.utrIndex === 'object' ? parsed.utrIndex : {},
      };
    }
  } catch (err) {
    console.error('Failed to read store data file, initializing fresh DB:', err);
  }

  return {
    storeConfig: { ...DEFAULT_STORE_CONFIG },
    orders: [],
    vault: buildInitialVault(),
    utrIndex: {},
  };
}

function saveDb(db: PersistedDatabase) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist store data:', err);
  }
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
  isRental24h: boolean,
  orderId: string
): string {
  const targetPool = isRental24h ? 'rental_24h' : 'permanent';
  const availableInPool = db.vault.filter(
    (v) => !v.isAssigned && v.poolType === targetPool
  );
  const allInPool = db.vault.filter((v) => v.poolType === targetPool);

  const presetMaster = isRental24h
    ? (db.storeConfig.presetRentalCredentials || '').trim()
    : (db.storeConfig.presetPermanentCredentials || '').trim();

  const presetLines = presetMaster
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const allocatedLines: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < quantity; i++) {
    const vaultItem = availableInPool[i];
    if (vaultItem) {
      vaultItem.isAssigned = true;
      vaultItem.assignedOrderId = orderId;
      vaultItem.updatedAt = now;
      allocatedLines.push(
        `Username: ${vaultItem.irctcUsername} | Password: ${vaultItem.irctcPassword}${
          vaultItem.accountNote ? ` | ${vaultItem.accountNote}` : ''
        }`
      );
    } else if (presetLines.length > 0) {
      allocatedLines.push(presetLines[i % presetLines.length]);
    } else if (allInPool.length > 0) {
      const fallbackVault = allInPool[i % allInPool.length];
      allocatedLines.push(
        `Username: ${fallbackVault.irctcUsername} | Password: ${fallbackVault.irctcPassword}${
          fallbackVault.accountNote ? ` | ${fallbackVault.accountNote}` : ''
        }`
      );
    } else {
      allocatedLines.push(
        isRental24h
          ? DEFAULT_STORE_CONFIG.presetRentalCredentials!
          : DEFAULT_STORE_CONFIG.presetPermanentCredentials!
      );
    }
  }

  return allocatedLines.join('\n');
}

/**
 * Preview what credentials will be used for an order from Ready Vault without mutating state yet.
 */
function previewVaultCredentials(quantity: number, isRental24h: boolean): string {
  const targetPool = isRental24h ? 'rental_24h' : 'permanent';
  const availableInPool = db.vault.filter(
    (v) => !v.isAssigned && v.poolType === targetPool
  );
  const presetMaster = isRental24h
    ? (db.storeConfig.presetRentalCredentials || '').trim()
    : (db.storeConfig.presetPermanentCredentials || '').trim();
  const presetLines = presetMaster
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const lines: string[] = [];
  for (let i = 0; i < quantity; i++) {
    const v = availableInPool[i];
    if (v) {
      lines.push(
        `Username: ${v.irctcUsername} | Password: ${v.irctcPassword}${
          v.accountNote ? ` | ${v.accountNote}` : ''
        }`
      );
    } else if (presetLines.length > 0) {
      lines.push(presetLines[i % presetLines.length]);
    }
  }
  return lines.join('\n');
}

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
    res.json({ storeConfig: db.storeConfig });
  });

  // Update Store Config
  app.put('/api/store', requireAdminAuth, (req, res) => {
    const body = req.body || {};
    const updated: StoreConfig = {
      siteTitle: String(body.siteTitle || db.storeConfig.siteTitle || 'Roshanbrand')
        .trim()
        .slice(0, LIMITS.SITE_TITLE_MAX),
      announcementText: String(
        body.announcementText || db.storeConfig.announcementText
      )
        .trim()
        .slice(0, LIMITS.ANNOUNCEMENT_MAX),
      upiId: String(body.upiId || db.storeConfig.upiId || 'roshanbrand.pay@okaxis')
        .trim()
        .slice(0, LIMITS.UPI_ID_MAX),
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
      price1Id: Math.max(1, Math.min(100000, Math.floor(Number(body.price1Id) || 350))),
      price2Id: Math.max(1, Math.min(100000, Math.floor(Number(body.price2Id) || 680))),
      price5Id: Math.max(1, Math.min(200000, Math.floor(Number(body.price5Id) || 1700))),
      price10Id: Math.max(1, Math.min(500000, Math.floor(Number(body.price10Id) || 3300))),
      priceBulkPerId: Math.max(
        1,
        Math.min(100000, Math.floor(Number(body.priceBulkPerId) || 300))
      ),
      priceCustomPerId: Math.max(
        1,
        Math.min(100000, Math.floor(Number(body.priceCustomPerId) || 340))
      ),
      priceRental24h: Math.max(
        1,
        Math.min(100000, Math.floor(Number(body.priceRental24h) || 49))
      ),
      stockAvailable: Math.max(
        0,
        Math.min(100000, Math.floor(Number(body.stockAvailable) ?? 145))
      ),
      rentalStockAvailable: Math.max(
        0,
        Math.min(100000, Math.floor(Number(body.rentalStockAvailable) ?? 68))
      ),
      instantAutoVerify:
        typeof body.instantAutoVerify === 'boolean'
          ? body.instantAutoVerify
          : db.storeConfig.instantAutoVerify,
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
      instantDeliveryNote: String(
        body.instantDeliveryNote || db.storeConfig.instantDeliveryNote
      )
        .trim()
        .slice(0, LIMITS.DELIVERY_NOTE_MAX),
      updatedAt: new Date().toISOString(),
    };

    db.storeConfig = updated;
    saveDb(db);
    broadcastStateUpdate('config_updated', { storeConfig: db.storeConfig });
    res.json({ storeConfig: db.storeConfig });
  });

  // Verify UPI UTR & Create Order (0ms Instant Execution)
  app.post('/api/orders/verify-upi', (req, res) => {
    const body = req.body || {};
    const utrNumber = String(body.utrNumber || '')
      .trim()
      .replace(/\s+/g, '');

    if (
      utrNumber.length < LIMITS.UTR_MIN ||
      utrNumber.length > LIMITS.UTR_MAX ||
      !LIMITS.ALPHANUM_UTR_REGEX.test(utrNumber)
    ) {
      res.status(400).json({
        error:
          'Kripya valid 12-digit UPI UTR / Transaction Reference ID dalein (digits/letters only).',
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
    const isRental24h = Boolean(body.isRental24h || body.packType === 'rental_24h');
    const unitPrice = Math.max(
      1,
      Math.min(100000, Math.round(Number(body.unitPrice) || (isRental24h ? 49 : 350)))
    );
    const totalAmount = Math.max(
      1,
      Math.min(5000000, Math.round(Number(body.totalAmount) || quantity * unitPrice))
    );

    const now = new Date();
    const nowIso = now.toISOString();
    const orderId = `RB_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase()}`;

    let status: OrderRecord['status'] = 'pending_verification';
    let deliveredCredentials = '';
    let adminNote = '';
    let rentalExpiresAt: string | undefined = undefined;
    let verifiedAt: string | undefined = undefined;

    if (db.storeConfig.instantAutoVerify) {
      status = 'verified_delivered';
      deliveredCredentials = allocateCredentials(quantity, isRental24h, orderId);
      verifiedAt = nowIso;

      if (isRental24h) {
        const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        rentalExpiresAt = expires.toISOString();
        adminNote = `Instant UTR #${utrNumber} Verified · Pre-Set Ready Vault ID Dispatched (24H Active)`;
        db.storeConfig.rentalStockAvailable = Math.max(
          0,
          (db.storeConfig.rentalStockAvailable || 68) - quantity
        );
      } else {
        adminNote = `Instant UTR #${utrNumber} Verified · Pre-Set Ready Vault ID Dispatched`;
        db.storeConfig.stockAvailable = Math.max(
          0,
          (db.storeConfig.stockAvailable || 145) - quantity
        );
      }
    } else {
      // Pre-fill Ready Vault credentials on the pending order so Admin can verify in 1 click without typing!
      deliveredCredentials = previewVaultCredentials(quantity, isRental24h);
      adminNote = 'Awaiting 1-Click UTR Verification in Admin Panel';
    }

    const newOrder: OrderRecord = {
      orderId,
      packLabel: String(
        body.packLabel ||
          (isRental24h ? '24-Hour Rental IRCTC ID' : `${quantity} IRCTC ID Pack`)
      ).slice(0, 80),
      packType: body.packType || (isRental24h ? 'rental_24h' : 'pack_1'),
      isRental24h,
      rentalDurationHours: isRental24h ? 24 : undefined,
      rentalExpiresAt,
      quantity,
      unitPrice,
      totalAmount,
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

    db.orders.unshift(newOrder);
    db.utrIndex[utrNumber] = orderId;
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

    let creds = String(req.body?.deliveredCredentials || '').trim();
    // If Admin clicked 1-Click Verify without typing anything, automatically allocate from Ready ID Vault!
    if (creds.length < 3) {
      creds = allocateCredentials(
        order.quantity,
        Boolean(order.isRental24h),
        order.orderId
      );
    }

    const wasPending = order.status !== 'verified_delivered';
    const now = new Date();
    order.status = 'verified_delivered';
    order.deliveredCredentials = creds.slice(0, LIMITS.CREDENTIALS_MAX);
    order.updatedAt = now.toISOString();
    order.verifiedAt = order.verifiedAt || now.toISOString();

    if (order.isRental24h && !order.rentalExpiresAt) {
      order.rentalExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }
    order.adminNote = order.isRental24h
      ? `Admin Verified UTR #${order.utrNumber} · Ready Vault 24H Rental ID Sent`
      : `Admin Verified UTR #${order.utrNumber} · Ready Vault ID Sent`;

    // Mark matching vault usernames as assigned
    for (const v of db.vault) {
      if (!v.isAssigned && creds.includes(v.irctcUsername)) {
        v.isAssigned = true;
        v.assignedOrderId = order.orderId;
        v.updatedAt = now.toISOString();
      }
    }

    if (wasPending) {
      if (order.isRental24h) {
        db.storeConfig.rentalStockAvailable = Math.max(
          0,
          (db.storeConfig.rentalStockAvailable || 0) - order.quantity
        );
      } else {
        db.storeConfig.stockAvailable = Math.max(
          0,
          (db.storeConfig.stockAvailable || 0) - order.quantity
        );
      }
    }

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
    saveDb(db);
    broadcastStateUpdate('order_rejected', { order });

    res.json({ order });
  });

  // Admin Delete Order
  app.delete('/api/admin/orders/:orderId', (req, res) => {
    const { orderId } = req.params;
    const idx = db.orders.findIndex((o) => o.orderId === orderId);
    if (idx !== -1) {
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
    const poolType: 'permanent' | 'rental_24h' =
      req.body?.poolType === 'rental_24h' ? 'rental_24h' : 'permanent';

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
      const extraNote = parts.slice(2).join(' | ');
      const combinedNote = [
        batchNote,
        extraNote,
        poolType === 'rental_24h' ? '24H Active Rental' : 'Aadhaar Verified',
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
          (db.storeConfig.rentalStockAvailable || 0) + addedCount;
        // Also update the default Pre-Set Rental ID to the latest added ID so it's always ready!
        db.storeConfig.presetRentalCredentials = formattedAddedLines[0];
      } else {
        db.storeConfig.stockAvailable = (db.storeConfig.stockAvailable || 0) + addedCount;
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
