// ===== Users (for login) =====
const userSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, index: true, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
  },
  { timestamps: true }
);
const User = mongoose.models.User || mongoose.model('User', userSchema);

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
}

function signJwt(payload, secret, expiresInSec = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now()/1000);
  const exp = iat + expiresInSec;
  const body = { ...payload, iat, exp };
  const head = base64url(JSON.stringify(header));
  const pay = base64url(JSON.stringify(body));
  const data = head + '.' + pay;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${data}.${sig}`;
}

function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('bad token');
  const [head, pay, sig] = parts;
  const data = head + '.' + pay;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  if (expected !== sig) throw new Error('bad signature');
  const payload = JSON.parse(Buffer.from(pay.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString());
  if (payload.exp && Math.floor(Date.now()/1000) > payload.exp) throw new Error('expired');
  return payload;
}

function requireAuth(req, res, next) {
  try {
    if (!JWT_SECRET) return res.status(501).json({ error: 'auth not configured' });
    const h = req.header('authorization') || '';
    const m = h.match(/^Bearer (.+)$/i);
    if (!m) return res.status(401).json({ error: 'missing token' });
    const payload = verifyJwt(m[1], JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}
import express from 'express';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
const DIST_DIR = path.resolve(__dirname, 'dist');
const NODE_ENV = process.env.NODE_ENV || 'production';
const ENROLL_SECRET = process.env.ENROLL_SECRET || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const FIRMWARE_VERSION = process.env.FIRMWARE_VERSION || '';
const FIRMWARE_URL = process.env.FIRMWARE_URL || '';
const USE_DB_USERS = String(process.env.USE_DB_USERS || 'false').toLowerCase() === 'true';
const DATA_RETENTION_DAYS = Number(process.env.DATA_RETENTION_DAYS || 0);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);

// security & logging
app.set('trust proxy', 1); // respect X-Forwarded-* headers (for proxies/load balancers)
app.use(helmet({
  contentSecurityPolicy: false, // disabled due to inline styles from UI lib; enable/adjust in future
  hsts: NODE_ENV === 'production' ? undefined : false,
}));
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// Gzip/Br compression
app.use(compression());

// JSON body parsing
app.use(express.json({ limit: '256kb' }));

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
};
app.use(cors(corsOptions));

// Basic rate limiting for API routes (production only unless explicitly enabled)
let apiLimiter;
if (NODE_ENV === 'production' && RATE_LIMIT_MAX > 0) {
  apiLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    // Custom handler: return 429 with no body to avoid noisy message
    handler: (req, res, next, options) => {
      res.status(options.statusCode || 429).end();
    },
  });
}

// ===== Admin utilities (protected by ADMIN_TOKEN) =====
function requireAdmin(req, res, next) {
  // Option 1: JWT admin user
  if (JWT_SECRET) {
    const h = req.header('authorization') || '';
    const m = h.match(/^Bearer (.+)$/i);
    if (m) {
      try {
        const payload = verifyJwt(m[1], JWT_SECRET);
        if (payload.role === 'admin') {
          req.user = payload;
          return next();
        }
      } catch {}
    }
  }
  // Option 2: Admin token header
  if (ADMIN_TOKEN) {
    const tok = req.header('x-admin-token');
    if (tok === ADMIN_TOKEN) return next();
    return res.status(403).json({ error: 'forbidden' });
  }
  return res.status(501).json({ error: 'admin not configured' });
}

// Revoke/rotate API key for a device (admin)
app.post('/api/admin/devices/:deviceId/revoke-key', requireAdmin, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const newKey = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const s = await DeviceSettings.findOneAndUpdate(
      { deviceId },
      { $set: { apiKey: newKey } },
      { new: true, upsert: true }
    );
    res.json({ deviceId: s.deviceId, apiKey: s.apiKey });
  } catch (e) {
    console.error('POST /api/admin/devices/:deviceId/revoke-key error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Rename a device across collections (admin)
app.post('/api/admin/devices/:deviceId/rename', requireAdmin, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { newId } = req.body || {};
    if (!newId || typeof newId !== 'string') return res.status(400).json({ error: 'newId required' });
    // Update DeviceSettings
    await DeviceSettings.updateMany({ deviceId }, { $set: { deviceId: newId } });
    // Update other collections
    const updates = await Promise.all([
      Reading.updateMany({ deviceId }, { $set: { deviceId: newId } }),
      Ack.updateMany({ deviceId }, { $set: { deviceId: newId } }),
      WateringEvent.updateMany({ deviceId }, { $set: { deviceId: newId } }),
      Alert.updateMany({ deviceId }, { $set: { deviceId: newId } }),
      Schedule.updateMany({ deviceId }, { $set: { deviceId: newId } }),
    ]);
    res.json({ oldId: deviceId, newId, updated: updates.map(u => u.modifiedCount) });
  } catch (e) {
    console.error('POST /api/admin/devices/:deviceId/rename error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Application settings (singleton)
const appSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'global' },
    system: {
      deviceName: String,
      syncInterval: Number,
      autoBackup: Boolean,
      dataRetention: Number,
      darkMode: Boolean,
      language: String,
    },
    ota: {
      version: String,
      url: String,
    },
    connection: {
      apiEndpoint: String,
      wifiSSID: String,
      wifiPassword: String,
      enableSSL: Boolean,
      timeout: Number,
    },
    sensors: {
      moistureThresholdLow: Number,
      moistureThresholdHigh: Number,
      calibrationOffset: Number,
      sensorSensitivity: Number,
      readingFrequency: Number,
    },
    notifications: {
      emailNotifications: Boolean,
      pushNotifications: Boolean,
      soundAlerts: Boolean,
      emailAddress: String,
      alertFrequency: String,
    },
    account: {
      username: String,
      timezone: String,
      // do not store passwords here in plaintext; this is just a placeholder
    },
  },
  { timestamps: true, _id: false }
);
const AppSettings = mongoose.models.AppSettings || mongoose.model('AppSettings', appSettingsSchema, 'app_settings');

async function getAppSettings() {
  let doc = await AppSettings.findById('global');
  if (!doc) doc = await AppSettings.create({ _id: 'global' });
  return doc;
}

app.get('/api/app-settings', async (req, res) => {
  try {
    const doc = await getAppSettings();
    res.json(doc);
  } catch (e) {
    console.error('GET /api/app-settings error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.patch('/api/app-settings', async (req, res) => {
  try {
    const update = {};
    const allowed = ['system', 'connection', 'sensors', 'notifications', 'account'];
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];
    const doc = await AppSettings.findOneAndUpdate({ _id: 'global' }, { $set: update }, { new: true, upsert: true });
    // Dynamically adjust TTL according to system.dataRetention (days)
    const days = Number(doc?.system?.dataRetention || 0);
    if (Number.isFinite(days) && days > 0) {
      try { await updateTtlIndexes(days); } catch (e) { console.warn('TTL update failed:', e?.message || e); }
    }
    res.json(doc);
  } catch (e) {
    console.error('PATCH /api/app-settings error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update TTL indexes for time-series collections according to retention days
async function updateTtlIndexes(days) {
  const secs = Math.max(1, Math.floor(days * 86400));
  if (!mongoose.connection?.db) return;
  const db = mongoose.connection.db;
  const targets = [Reading, Ack, WateringEvent];
  for (const model of targets) {
    try {
      const coll = model.collection.collectionName;
      // try collMod; if index missing, create it
      try {
        await db.command({ collMod: coll, index: { name: 'createdAt_1', expireAfterSeconds: secs } });
        console.log(`[ttl] updated ${coll}.createdAt_1 -> ${secs}s`);
      } catch (e) {
        // Ensure index exists with TTL
        await db.collection(coll).createIndex({ createdAt: 1 }, { name: 'createdAt_1', expireAfterSeconds: secs });
        console.log(`[ttl] created ${coll}.createdAt_1 -> ${secs}s`);
      }
    } catch (e) {
      console.warn('[ttl] error for model', model?.modelName, e?.message || e);
    }
  }
}

// Moisture history aggregation per day (avg/min/max)
app.get('/api/history/moisture', async (req, res) => {
  try {
    const { deviceId, days = 7 } = req.query;
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
    const match = { createdAt: { $gte: since } };
    if (deviceId) match.deviceId = deviceId;
    const pipeline = [
      { $match: match },
      { $project: { deviceId: 1, createdAt: 1, moisture: 1, day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } },
      { $match: { moisture: { $ne: null } } },
      { $group: { _id: '$day', avg: { $avg: '$moisture' }, min: { $min: '$moisture' }, max: { $max: '$moisture' } } },
      { $project: { _id: 0, date: '$_id', avg: { $round: ['$avg', 2] }, min: 1, max: 1 } },
      { $sort: { date: 1 } }
    ];
    const rows = await Reading.aggregate(pipeline);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/history/moisture error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Watering summary per day (count and total duration minutes)
app.get('/api/history/watering-summary', async (req, res) => {
  try {
    const { deviceId, days = 7 } = req.query;
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
    const match = { createdAt: { $gte: since } };
    if (deviceId) match.deviceId = deviceId;
    const events = await WateringEvent.find(match).lean();
    const map = new Map();
    for (const ev of events) {
      const d = new Date(ev.startedAt || ev.createdAt);
      const key = d.toISOString().slice(0, 10);
      const ended = ev.endedAt ? new Date(ev.endedAt) : null;
      const mins = ended ? Math.max(0, Math.round((ended - d) / 60000)) : 0;
      if (!map.has(key)) map.set(key, { date: key, count: 0, minutes: 0 });
      const row = map.get(key);
      row.count += 1;
      row.minutes += mins;
    }
    const rows = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    res.json(rows);
  } catch (e) {
    console.error('GET /api/history/watering-summary error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Schedules schema and endpoints (basic CRUD)
const scheduleSchema = new mongoose.Schema(
  {
    deviceId: { type: String, index: true, required: true },
    time: { type: String, required: true }, // "HH:MM"
    enabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);
const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', scheduleSchema);

// List schedules
app.get('/api/schedules', async (req, res) => {
  try {
    const { deviceId } = req.query;
    const q = deviceId ? { deviceId } : {};
    const items = await Schedule.find(q).sort({ time: 1 });
    res.json(items);
  } catch (e) {
    console.error('GET /api/schedules error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Create schedule
app.post('/api/schedules', async (req, res) => {
  try {
    const { deviceId, time, enabled } = req.body || {};
    if (!deviceId || !time) return res.status(400).json({ error: 'deviceId and time are required' });
    const doc = await Schedule.create({ deviceId, time, enabled: !!enabled });
    res.status(201).json({ success: true, id: doc._id });
  } catch (e) {
    console.error('POST /api/schedules error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update schedule
app.patch('/api/schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['time', 'enabled'];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];
    const doc = await Schedule.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (e) {
    console.error('PATCH /api/schedules/:id error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Delete schedule
app.delete('/api/schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Schedule.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/schedules/:id error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Alerts schema and endpoints
const alertSchema = new mongoose.Schema(
  {
    deviceId: { type: String, index: true },
    type: { type: String, enum: ['moisture', 'pump', 'system'], default: 'system' },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    title: { type: String, required: true },
    description: { type: String },
    time: { type: Date, default: () => new Date() },
    isRead: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
const Alert = mongoose.models.Alert || mongoose.model('Alert', alertSchema);

// List alerts
app.get('/api/alerts', async (req, res) => {
  try {
    const { deviceId, active } = req.query;
    const q = {};
    if (deviceId) q.deviceId = deviceId;
    if (active !== undefined) q.isActive = active === 'true';
    const items = await Alert.find(q).sort({ createdAt: -1 }).limit(500);
    res.json(items);
  } catch (e) {
    console.error('GET /api/alerts error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Create alert
app.post('/api/alerts', async (req, res) => {
  try {
    const { deviceId, type, severity, title, description, time } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    const doc = await Alert.create({ deviceId, type, severity, title, description, time });
    res.status(201).json({ success: true, id: doc._id });
  } catch (e) {
    console.error('POST /api/alerts error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update alert (mark read/active)
app.patch('/api/alerts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['isRead', 'isActive'];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];
    const doc = await Alert.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (e) {
    console.error('PATCH /api/alerts/:id error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Mark all alerts as read for a device
app.post('/api/alerts/mark-all-read', async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    await Alert.updateMany({ deviceId, isRead: false }, { $set: { isRead: true } });
    res.json({ success: true });
  } catch (e) {
    console.error('POST /api/alerts/mark-all-read error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
if (apiLimiter) {
  app.use('/api', apiLimiter);
}

// Health check
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection?.readyState;
  const dbConnected = dbState === 1; // 1 connected, 2 connecting, 0 disconnected
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    nodeEnv: NODE_ENV,
    dbConnected,
    uptimeSec: Math.round(process.uptime()),
  });
});

// OTA manifest (simple global manifest; could be extended per device)
app.get('/api/ota/manifest', async (req, res) => {
  try {
    const doc = await getAppSettings();
    const v = doc?.ota?.version || FIRMWARE_VERSION;
    const u = doc?.ota?.url || FIRMWARE_URL;
    res.json({ version: v, url: u });
  } catch (e) {
    res.json({ version: FIRMWARE_VERSION, url: FIRMWARE_URL });
  }
});

// Admin: set OTA manifest values in AppSettings
app.post('/api/admin/ota', requireAdmin, async (req, res) => {
  try {
    const { version, url } = req.body || {};
    const update = { };
    if (version !== undefined) update['ota.version'] = version;
    if (url !== undefined) update['ota.url'] = url;
    const doc = await AppSettings.findOneAndUpdate({ _id: 'global' }, { $set: update }, { new: true, upsert: true });
    res.json({ version: doc?.ota?.version || null, url: doc?.ota?.url || null });
  } catch (e) {
    console.error('POST /api/admin/ota error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Auth endpoints
app.post('/api/auth/login', async (req, res) => {
  try {
    if (!JWT_SECRET) return res.status(501).json({ error: 'auth not configured' });
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    if (!USE_DB_USERS) {
      // Env-based admin login only
      if (ADMIN_EMAIL && ADMIN_PASSWORD && email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        const token = signJwt({ sub: 'admin', email: ADMIN_EMAIL, role: 'admin' }, JWT_SECRET, 24*3600);
        return res.json({ token, user: { email: ADMIN_EMAIL, role: 'admin' } });
      }
      return res.status(401).json({ error: 'invalid credentials' });
    } else {
      const u = await User.findOne({ email });
      if (!u) return res.status(401).json({ error: 'invalid credentials' });
      const ok = u.passwordHash === sha256(password);
      if (!ok) return res.status(401).json({ error: 'invalid credentials' });
      const token = signJwt({ sub: u._id.toString(), email: u.email, role: u.role }, JWT_SECRET, 24*3600);
      return res.json({ token, user: { email: u.email, role: u.role } });
    }
  } catch (e) {
    console.error('POST /api/auth/login error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    // For env-based auth, just echo from token
    if (!USE_DB_USERS) return res.json({ email: req.user.email, role: req.user.role });
    // DB-backed users
    const u = await User.findById(req.user.sub).select('email role');
    if (!u) return res.json({ email: req.user.email, role: req.user.role });
    return res.json(u);
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// MongoDB connection and schema
// Devices registry (metadata and online status)
const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true, index: true },
    name: { type: String },
    location: { type: String },
    tags: { type: [String], default: [] },
    lastSeen: { type: Date },
  },
  { timestamps: true }
);
const Device = mongoose.models.Device || mongoose.model('Device', deviceSchema);
const readingSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    temperature: { type: Number },
    humidity: { type: Number },
    co2: { type: Number },
    moisture: { type: Number },
    payload: { type: Object },
  },
  { timestamps: true }
);

// TTL index for readings (optional)
if (DATA_RETENTION_DAYS > 0) {
  readingSchema.index({ createdAt: 1 }, { expireAfterSeconds: DATA_RETENTION_DAYS * 86400 });
}

const Reading = mongoose.models.Reading || mongoose.model('Reading', readingSchema);

// Device settings schema (persist desired control state/config)
const deviceSettingsSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true, index: true },
    pumpMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    overridePumpOn: { type: Boolean, default: false },
    pumpOnBelow: { type: Number, default: 35 },
    pumpOffAbove: { type: Number, default: 45 },
    apiKey: { type: String, default: () => Math.random().toString(36).slice(2) },
  },
  { timestamps: true }
);

const DeviceSettings = mongoose.models.DeviceSettings || mongoose.model('DeviceSettings', deviceSettingsSchema);

async function getOrCreateSettings(deviceId) {
  let s = await DeviceSettings.findOne({ deviceId });
  if (!s) {
    // Seed defaults from App Settings (sensors) if available
    let seed = {};
    try {
      const app = await getAppSettings();
      const low = Number(app?.sensors?.moistureThresholdLow);
      const high = Number(app?.sensors?.moistureThresholdHigh);
      if (Number.isFinite(low)) seed.pumpOnBelow = low;
      if (Number.isFinite(high)) seed.pumpOffAbove = high;
    } catch {}
    s = await DeviceSettings.create({ deviceId, ...seed });
  }
  return s;
}

// API key middleware for device-origin requests
async function requireApiKey(req, res, next) {
  try {
    const deviceId = req.params.deviceId || req.body?.deviceId || req.query?.deviceId;
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
    const key = req.header('x-api-key');
    if (!key) return res.status(401).json({ error: 'missing api key' });
    const settings = await getOrCreateSettings(deviceId);
    if (settings.apiKey !== key) return res.status(403).json({ error: 'invalid api key' });
    next();
  } catch (e) {
    console.error('API key check failed:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// API endpoints
app.post('/api/readings', requireApiKey, async (req, res) => {
  try {
    const { deviceId, temperature, humidity, co2, moisture, payload } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
    const now = new Date();
    // Upsert device lastSeen
    try { await Device.updateOne({ deviceId }, { $set: { lastSeen: now } }, { upsert: true }); } catch {}
    const doc = await Reading.create({ deviceId, temperature, humidity, co2, moisture, payload });
    return res.status(201).json({ success: true, id: doc._id });
  } catch (err) {
    console.error('POST /api/readings error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Ack schema: store latest device-applied state
const ackSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    pumpOn: { type: Boolean, required: true },
    pumpMode: { type: String, enum: ['auto', 'manual'], required: true },
    note: { type: String },
  },
  { timestamps: true }
);
const Ack = mongoose.models.Ack || mongoose.model('Ack', ackSchema);

// TTL index for acks (optional)
if (DATA_RETENTION_DAYS > 0) {
  ackSchema.index({ createdAt: 1 }, { expireAfterSeconds: DATA_RETENTION_DAYS * 86400 });
}

// POST ack from device
app.post('/api/devices/:deviceId/ack', requireApiKey, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { pumpOn, pumpMode, note } = req.body || {};
    if (typeof pumpOn !== 'boolean' || (pumpMode !== 'auto' && pumpMode !== 'manual')) {
      return res.status(400).json({ error: 'pumpOn (boolean) and pumpMode (auto|manual) are required' });
    }
    const now = new Date();
    try { await Device.updateOne({ deviceId }, { $set: { lastSeen: now } }, { upsert: true }); } catch {}
    const doc = await Ack.create({ deviceId, pumpOn, pumpMode, note });
    // Record watering event transitions
    await handleAckForEvents(deviceId, pumpOn, pumpMode);
    return res.status(201).json({ success: true, id: doc._id });
  } catch (err) {
    console.error('POST /api/devices/:deviceId/ack error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET latest ack for device
app.get('/api/devices/:deviceId/ack', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const doc = await Ack.findOne({ deviceId }).sort({ createdAt: -1 });
    return res.json(doc || null);
  } catch (err) {
    console.error('GET /api/devices/:deviceId/ack error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Watering events based on ACK transitions
const wateringEventSchema = new mongoose.Schema(
  {
    deviceId: { type: String, index: true },
    startedAt: { type: Date },
    endedAt: { type: Date },
    triggeredBy: { type: String, enum: ['auto', 'manual'], required: true },
  },
  { timestamps: true }
);
const WateringEvent = mongoose.models.WateringEvent || mongoose.model('WateringEvent', wateringEventSchema);

// TTL index for watering events (optional)
if (DATA_RETENTION_DAYS > 0) {
  wateringEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: DATA_RETENTION_DAYS * 86400 });
}

// Helper: create/close events on ack
async function handleAckForEvents(deviceId, pumpOn, pumpMode) {
  const open = await WateringEvent.findOne({ deviceId, endedAt: { $exists: false } }).sort({ createdAt: -1 });
  if (pumpOn) {
    if (!open) {
      await WateringEvent.create({ deviceId, startedAt: new Date(), triggeredBy: pumpMode });
    }
  } else {
    if (open) {
      open.endedAt = new Date();
      await open.save();
    }
  }
}

// (Removed brittle router stack hack; events handled within ACK handler)

// Watering events listing
app.get('/api/watering', async (req, res) => {
  try {
    const { deviceId, from, to, limit = 100 } = req.query;
    const q = {};
    if (deviceId) q.deviceId = deviceId;
    if (from || to) {
      q.createdAt = {};
      if (from) q.createdAt.$gte = new Date(from);
      if (to) q.createdAt.$lte = new Date(to);
    }
    const items = await WateringEvent.find(q).sort({ createdAt: -1 }).limit(Number(limit));
    res.json(items);
  } catch (e) {
    console.error('GET /api/watering error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/readings', async (req, res) => {
  try {
    const { deviceId, limit = 50 } = req.query;
    const q = deviceId ? { deviceId } : {};
    const items = await Reading.find(q).sort({ createdAt: -1 }).limit(Number(limit));
    return res.json(items);
  } catch (err) {
    console.error('GET /api/readings error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// List devices (by distinct deviceId from readings and settings)
app.get('/api/devices', async (req, res) => {
  try {
    // Return device IDs based on Device registry only, mirroring /api/devices/registry
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.json([]);
    }
    const docs = await Device.find({}, { deviceId: 1, _id: 0 }).sort({ updatedAt: -1 }).lean();
    return res.json(docs.map(d => d.deviceId));
  } catch (err) {
    console.error('GET /api/devices error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Devices registry with metadata and online flag
app.get('/api/devices/registry', async (req, res) => {
  try {
    // If DB not connected, return empty list gracefully (dev without DB)
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.json([]);
    }
    const docs = await Device.find({}).sort({ updatedAt: -1 }).lean();
    const now = Date.now();
    // Dynamic online window from App Settings: 2x syncInterval (seconds), min 30s
    let onlineWindowMs = 30_000;
    try {
      const app = await getAppSettings();
      const syncIntervalSec = Number(app?.system?.syncInterval) || 60;
      onlineWindowMs = Math.max(30, syncIntervalSec * 2) * 1000;
    } catch {}
    const items = docs.map(d => ({
      deviceId: d.deviceId,
      name: d.name || d.deviceId,
      location: d.location || null,
      tags: d.tags || [],
      lastSeen: d.lastSeen || null,
      online: d.lastSeen ? (now - new Date(d.lastSeen).getTime() <= onlineWindowMs) : false,
    }));
    return res.json(items);
  } catch (e) {
    console.error('GET /api/devices/registry error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin: update device metadata
app.patch('/api/admin/devices/:deviceId/meta', requireAdmin, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const allowed = ['name', 'location', 'tags'];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];
    const doc = await Device.findOneAndUpdate({ deviceId }, { $set: update }, { new: true, upsert: true });
    res.json(doc);
  } catch (e) {
    console.error('PATCH /api/admin/devices/:deviceId/meta error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get device settings
app.get('/api/devices/:deviceId/settings', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const s = await getOrCreateSettings(deviceId);
    return res.json(s);
  } catch (err) {
    console.error('GET /api/devices/:deviceId/settings error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update device settings (partial)
app.patch('/api/devices/:deviceId/settings', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const allowed = ['pumpMode', 'overridePumpOn', 'pumpOnBelow', 'pumpOffAbove'];
    const update = {};
    for (const k of allowed) {
      if (k in req.body) update[k] = req.body[k];
    }
    const s = await DeviceSettings.findOneAndUpdate(
      { deviceId },
      { $set: update },
      { new: true, upsert: true }
    );
    return res.json(s);
  } catch (err) {
    console.error('PATCH /api/devices/:deviceId/settings error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Rotate API key
app.post('/api/devices/:deviceId/rotate-key', async (req, res) => {
  try {
    const { deviceId } = req.params;
    // Optional enrollment secret check (for provisioning security)
    if (ENROLL_SECRET) {
      const provided = req.header('x-enroll-secret') || '';
      if (provided !== ENROLL_SECRET) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }
    const newKey = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const s = await DeviceSettings.findOneAndUpdate(
      { deviceId },
      { $set: { apiKey: newKey } },
      { new: true, upsert: true }
    );
    return res.json({ deviceId, apiKey: s.apiKey });
  } catch (err) {
    console.error('POST /api/devices/:deviceId/rotate-key error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Serve static assets from Vite build
app.use(express.static(DIST_DIR, { index: false, maxAge: '1y', immutable: true }));

// SPA fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

async function start() {
  try {
    if (!MONGODB_URI) {
      console.warn('MONGODB_URI not set. API will start without DB connection.');
    } else {
      await mongoose.connect(MONGODB_URI, { dbName: process.env.MONGODB_DB || undefined });
      console.log('Connected to MongoDB');
      // Seed admin user only when using DB users
      if (USE_DB_USERS && ADMIN_EMAIL && ADMIN_PASSWORD) {
        const exists = await User.findOne({ email: ADMIN_EMAIL });
        if (!exists) {
          await User.create({ email: ADMIN_EMAIL, passwordHash: sha256(ADMIN_PASSWORD), role: 'admin' });
          console.log('Admin user seeded:', ADMIN_EMAIL);
        }
      }
    }
    const server = app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });

    const shutdown = async (signal) => {
      try {
        console.log(`\n${signal} received. Gracefully shutting down...`);
        await mongoose.connection.close();
      } catch (e) {
        console.error('Error during shutdown (DB):', e);
      }
      server.close(() => {
        console.log('HTTP server closed. Bye.');
        process.exit(0);
      });
      // Force exit if not closed in time
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
