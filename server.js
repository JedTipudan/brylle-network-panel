/**
 * Pro Secure server.js - Brylle's Network & Data Solution
 * - Admin login (simple, local config.json)
 * - Session via express-session (cookie)
 * - Local JSON data storage
 * - Socket.IO notifications & cron checks
 */

const express = require('express');
const session = require('express-session');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const NOTIFS_FILE = path.join(DATA_DIR, 'notifications.json');
const SMS_LOG = path.join(DATA_DIR, 'sms.log');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session setup
app.use(session({
  secret: 'brylle-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// ===== Utility Functions =====
async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(CLIENTS_FILE); } catch { await fs.writeFile(CLIENTS_FILE, '[]', 'utf8'); }
  try { await fs.access(NOTIFS_FILE); } catch { await fs.writeFile(NOTIFS_FILE, '[]', 'utf8'); }
  try { await fs.access(SMS_LOG); } catch { await fs.writeFile(SMS_LOG, '', 'utf8'); }
}

async function readClients() {
  const raw = await fs.readFile(CLIENTS_FILE, 'utf8');
  return JSON.parse(raw || '[]');
}
async function writeClients(arr) {
  await fs.writeFile(CLIENTS_FILE, JSON.stringify(arr, null, 2), 'utf8');
}
async function readNotifs() {
  const raw = await fs.readFile(NOTIFS_FILE, 'utf8');
  return JSON.parse(raw || '[]');
}
async function appendNotif(n) {
  const arr = await readNotifs();
  arr.unshift(n);
  await fs.writeFile(NOTIFS_FILE, JSON.stringify(arr.slice(0, 200), null, 2), 'utf8');
}
async function logSms(line) {
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  await fs.appendFile(SMS_LOG, entry, 'utf8');
}

function formatDateISO(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ===== Simulated SMS =====
async function sendSMS(phone, message) {
  await logSms(`SIMULATED to ${phone}: ${message}`);
  console.log(`[SIMULATED SMS] to ${phone}: ${message}`);
  return { success: true, method: 'simulated' };
}

// ===== Daily Check =====
async function runDailyCheck() {
  console.log('Running due-date check...');
  const clients = await readClients();
  const today = formatDateISO(new Date());
  for (const client of clients) {
    if (!client.dueDate) continue;
    if ((client.status !== 'Paid') && (client.dueDate <= today)) {
      const msg = `Hi ${client.name}, your payment for Brylle's Network & Data Solution is due ${client.dueDate === today ? 'today' : `on ${client.dueDate}`}. Please settle to avoid interruption. Thank you!`;
      const smsResult = await sendSMS(client.phone, msg);
      const notif = {
        id: uuidv4(),
        time: new Date().toISOString(),
        clientId: client.id,
        clientName: client.name,
        dueDate: client.dueDate,
        message: msg,
        sms: smsResult
      };
      await appendNotif(notif);
      io.emit('notification', notif);
    }
  }
  console.log('Check complete.');
}

// ===== Auth Middleware =====
function requireAuth(req, res, next) {
  if (req.session && req.session.user === 'admin') return next();
  res.redirect('/login.html');
}

// ===== ROUTES =====

// Root: redirect to login or dashboard
app.get('/', (req, res) => {
  if (req.session && req.session.user === 'admin') {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login.html');
  }
});

// Dashboard (protected)
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: Clients
app.get('/api/clients', requireAuth, async (req, res) => {
  res.json(await readClients());
});

app.post('/api/clients', requireAuth, async (req, res) => {
  const { name, phone, plan, dueDate } = req.body;
  if (!name || !phone || !dueDate)
    return res.status(400).json({ error: 'name, phone and dueDate required' });
  const clients = await readClients();
  const newClient = {
    id: uuidv4(),
    name: name.trim(),
    phone: phone.trim(),
    plan: (plan || '').trim(),
    dueDate: dueDate.trim(),
    status: 'Active',
    createdAt: new Date().toISOString()
  };
  clients.push(newClient);
  await writeClients(clients);
  res.json(newClient);
});

app.post('/api/clients/:id/pay', requireAuth, async (req, res) => {
  const id = req.params.id;
  const clients = await readClients();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'client not found' });
  clients[idx].status = 'Paid';
  clients[idx].paidAt = new Date().toISOString();
  await writeClients(clients);
  res.json(clients[idx]);
});

app.delete('/api/clients/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  let clients = await readClients();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'client not found' });
  const removed = clients.splice(idx, 1)[0];
  await writeClients(clients);
  res.json({ ok: true, removed });
});

// API: Notifications
app.get('/api/notifications', requireAuth, async (req, res) => {
  res.json(await readNotifs());
});

app.post('/api/run-check-now', requireAuth, async (req, res) => {
  await runDailyCheck();
  res.json({ ok: true, message: 'Check executed' });
});

// ===== LOGIN =====
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
  const cfg = await readConfig();
  const admin = cfg.admin || { username: 'admin', password: 'admin' };
  const { username, password } = req.body;

  if (username === admin.username && password === admin.password) {
    req.session.user = 'admin';
    return res.json({ ok: true });
  } else {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

// ===== STATIC FILES (after routes) =====
app.use(express.static(path.join(__dirname, 'public')));

// ===== START SERVER =====
(async () => {
  await ensureDataFiles();
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`✅ Server running at http://localhost:${port}`));

  io.on('connection', socket => {
    console.log('Socket connected:', socket.id);
  });

  cron.schedule('0 8 * * *', async () => {
    try {
      console.log('Cron triggered (08:00 Asia/Manila)');
      await runDailyCheck();
    } catch (e) {
      console.error('Cron error', e);
    }
  }, { timezone: 'Asia/Manila' });
})();
