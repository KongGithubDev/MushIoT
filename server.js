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

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
const DIST_DIR = path.resolve(__dirname, 'dist');
const NODE_ENV = process.env.NODE_ENV || 'production';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);

// security & logging
app.set('trust proxy', 1); // respect X-Forwarded-* headers (for proxies/load balancers)
app.use(helmet({
  contentSecurityPolicy: false, // adjust if you add inline scripts
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
};
app.use(cors(corsOptions));

// Basic rate limiting for API routes
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
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
    res.json(doc);
  } catch (e) {
    console.error('PATCH /api/app-settings error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

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
app.use('/api', apiLimiter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// MongoDB connection and schema
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
    s = await DeviceSettings.create({ deviceId });
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

// POST ack from device
app.post('/api/devices/:deviceId/ack', requireApiKey, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { pumpOn, pumpMode, note } = req.body || {};
    if (typeof pumpOn !== 'boolean' || (pumpMode !== 'auto' && pumpMode !== 'manual')) {
      return res.status(400).json({ error: 'pumpOn (boolean) and pumpMode (auto|manual) are required' });
    }
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
    const fromReadings = await Reading.distinct('deviceId');
    const fromSettings = await DeviceSettings.distinct('deviceId');
    const ids = Array.from(new Set([...fromReadings, ...fromSettings]));
    return res.json(ids);
  } catch (err) {
    console.error('GET /api/devices error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
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
