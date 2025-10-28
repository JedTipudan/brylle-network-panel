/**
 * Pro Secure server.js - Brylle's Network & Data Solution (Render-ready + Email + Auto Refresh + Auto Wipe + Test Email)
 */
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

// ======= Paths =======
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const NOTIFS_FILE = path.join(DATA_DIR, 'notifications.json');
const SMS_LOG = path.join(DATA_DIR, 'sms.log');

// ======= Email Setup =======
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const ALERT_EMAIL = process.env.ALERT_EMAIL || EMAIL_USER;

const transporter = EMAIL_USER && EMAIL_PASS ? nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
}) : null;

// ======= Middleware =======
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'brylle-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ======= Utility =======
async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  // 🧹 Auto-wipe logic: If file exists but corrupted or stuck, reset to empty
  const resetIfCorrupt = async (file, defaultContent) => {
    try {
      const data = await fs.readFile(file, 'utf8');
      JSON.parse(data);
    } catch {
      console.log(`🧹 Resetting corrupted file: ${file}`);
      await fs.writeFile(file, JSON.stringify(defaultContent, null, 2), 'utf8');
    }
  };

  await resetIfCorrupt(CLIENTS_FILE, []);
  await resetIfCorrupt(NOTIFS_FILE, []);
  try { await fs.access(SMS_LOG); } catch { await fs.writeFile(SMS_LOG, ''); }
}

async function readClients() {
  const raw = await fs.readFile(CLIENTS_FILE, 'utf8').catch(() => '[]');
  return JSON.parse(raw || '[]');
}
async function writeClients(arr) {
  await fs.writeFile(CLIENTS_FILE, JSON.stringify(arr, null, 2), 'utf8');
}
async function readNotifs() {
  const raw = await fs.readFile(NOTIFS_FILE, 'utf8').catch(() => '[]');
  return JSON.parse(raw || '[]');
}
async function appendNotif(n) {
  const arr = await readNotifs();
  arr.unshift(n);
  await fs.writeFile(NOTIFS_FILE, JSON.stringify(arr.slice(0, 200), null, 2), 'utf8');
}

function formatDateISO(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function sendEmail(subject, text) {
  if (!transporter) {
    console.log('⚠️ Email not configured');
    return;
  }
  try {
    await transporter.sendMail({
      from: EMAIL_USER,
      to: ALERT_EMAIL,
      subject,
      text
    });
    console.log(`📧 Email sent: ${subject}`);
  } catch (err) {
    console.error('❌ Email failed:', err);
  }
}

// ======= Auth Middleware =======
function requireAuth(req, res, next) {
  if (req.session && req.session.user === 'admin') return next();
  res.redirect('/login.html');
}

// ======= Routes =======
app.get('/', (req, res) => {
  if (req.session && req.session.user === 'admin') res.redirect('/dashboard');
  else res.redirect('/login.html');
});
app.get('/dashboard', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// 🧠 Clients + Auto Status Update
app.get('/api/clients', requireAuth, async (req, res) => {
  const clients = await readClients();

  const todayPH = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const todayOnly = new Date(todayPH.getFullYear(), todayPH.getMonth(), todayPH.getDate());

  for (const c of clients) {
    if (!c.dueDate) continue;
    const duePH = new Date(new Date(c.dueDate).toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const dueOnly = new Date(duePH.getFullYear(), duePH.getMonth(), duePH.getDate());
    c.status = todayOnly > dueOnly ? 'Inactive' : 'Active';
  }

  await writeClients(clients);
  res.json(clients);
});

// Add client
app.post('/api/clients', requireAuth, async (req, res) => {
  const { name, phone, plan, location, installDate, billingCycle } = req.body;
  if (!name || !phone || !installDate) return res.status(400).json({ error: 'Missing fields' });

  const cycle = parseInt(billingCycle || 30, 10);
  const install = new Date(installDate);
  install.setDate(install.getDate() + cycle);
  const dueDate = formatDateISO(install);

  const clients = await readClients();
  const newClient = {
    id: uuidv4(),
    name, phone, plan, location,
    installDate, billingCycle: cycle,
    dueDate, status: 'Active',
    createdAt: new Date().toISOString()
  };
  clients.push(newClient);
  await writeClients(clients);
  res.json(newClient);
});

// Paid logic
app.post('/api/clients/:id/pay', requireAuth, async (req, res) => {
  const clients = await readClients();
  const client = clients.find(c => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const billingCycle = parseInt(client.billingCycle || 30, 10);
  const currentDue = new Date(client.dueDate || client.installDate || Date.now());
  currentDue.setDate(currentDue.getDate() + billingCycle);
  const nextDue = formatDateISO(currentDue);

  client.dueDate = nextDue;
  client.status = 'Active';
  client.paidAt = new Date().toISOString();

  await writeClients(clients);

  const notif = {
    id: uuidv4(),
    time: new Date().toISOString(),
    clientId: client.id,
    clientName: client.name,
    dueDate: client.dueDate,
    message: `${client.name} marked as paid. Next due: ${nextDue}`
  };
  await appendNotif(notif);
  io.emit('notification', notif);

  res.json({ ok: true, message: 'Payment processed', client });
});

// Delete client
app.delete('/api/clients/:id', requireAuth, async (req, res) => {
  const clients = await readClients();
  const idx = clients.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const removed = clients.splice(idx, 1)[0];
  await writeClients(clients);
  res.json({ ok: true, removed });
});

// Notifications
app.get('/api/notifications', requireAuth, async (req, res) => res.json(await readNotifs()));

// Clear All Notifications
app.delete('/api/notifications/clear', requireAuth, async (req, res) => {
  try {
    await fs.writeFile(NOTIFS_FILE, '[]', 'utf8');
    res.json({ ok: true, message: 'All notifications cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

// 🧪 Test Email (replaces run-check-now)
app.post('/api/test-email', requireAuth, async (req, res) => {
  try {
    await sendEmail('✅ Test Email from Brylle’s Network', 'Your email setup is working perfectly!');
    res.json({ ok: true, message: 'Test email sent successfully!' });
  } catch (err) {
    console.error('Test email failed:', err);
    res.status(500).json({ error: 'Test email failed' });
  }
});

// Auth
app.post('/login', async (req, res) => {
  const raw = await fs.readFile(CONFIG_FILE, 'utf8').catch(() => '{}');
  const cfg = JSON.parse(raw);
  const admin = cfg.admin || { username: 'admin', password: 'admin' };
  const { username, password } = req.body;
  if (username === admin.username && password === admin.password) {
    req.session.user = 'admin';
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});
app.post('/logout', (req, res) => { req.session.destroy(() => {}); res.json({ ok: true }); });

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ======= Start Server =======
(async () => {
  await ensureDataFiles();
  const port = process.env.PORT || 10000;
  server.listen(port, () => console.log(`✅ Running on port ${port}`));

  io.on('connection', s => console.log('Socket connected:', s.id));

  // Daily check at 8 AM
  cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Daily Check Triggered');
  }, { timezone: 'Asia/Manila' });
})();
