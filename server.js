/**
 * Brylle’s Network & Data Solution
 * Render-ready + Resend Email Test Mode (using domain https://brylle-network-panel.onrender.com)
 */
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const socketio = require('socket.io');
const { Resend } = require('resend');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// ===== Paths =====
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const NOTIFS_FILE = path.join(DATA_DIR, 'notifications.json');
const SMS_LOG = path.join(DATA_DIR, 'sms.log');

// ===== Email (Resend) =====
const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_USER = process.env.EMAIL_USER;
const ALERT_EMAIL = process.env.ALERT_EMAIL || EMAIL_USER;

// ===== Middleware =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'brylle-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 86400000 }
}));

// ===== Utilities =====
async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const resetIfCorrupt = async (file, def) => {
    try { JSON.parse(await fs.readFile(file, 'utf8')); }
    catch { await fs.writeFile(file, JSON.stringify(def, null, 2)); }
  };
  await resetIfCorrupt(CLIENTS_FILE, []);
  await resetIfCorrupt(NOTIFS_FILE, []);
  try { await fs.access(SMS_LOG); } catch { await fs.writeFile(SMS_LOG, ''); }
}
const readClients = async () => JSON.parse(await fs.readFile(CLIENTS_FILE, 'utf8').catch(() => '[]'));
const writeClients = arr => fs.writeFile(CLIENTS_FILE, JSON.stringify(arr, null, 2));
const readNotifs = async () => JSON.parse(await fs.readFile(NOTIFS_FILE, 'utf8').catch(() => '[]'));
const appendNotif = async n => {
  const arr = await readNotifs();
  arr.unshift(n);
  await fs.writeFile(NOTIFS_FILE, JSON.stringify(arr.slice(0, 200), null, 2));
};
const formatDateISO = d => d.toISOString().slice(0, 10);

// ======= Email Function (Resend Test Mode - no domain verify) =======
async function sendEmail(subject, html) {
  try {
    const data = await resend.emails.send({
      from: 'onboarding@resend.dev',   // ✅ official Resend test sender (no domain verification required)
      to: ALERT_EMAIL,                  // your Gmail in .env
      subject,
      html,
    });
    console.log('📧 Email sent via Resend:', data);
  } catch (error) {
    console.error('❌ Email failed:', error);
  }
}


// ===== Auth =====
function requireAuth(req, res, next) {
  if (req.session?.user === 'admin') return next();
  res.redirect('/login.html');
}

// ===== Routes =====
app.get('/', (req, res) => {
  if (req.session?.user === 'admin') res.redirect('/dashboard');
  else res.redirect('/login.html');
});

app.get('/dashboard', requireAuth, (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// 👥 Clients
app.get('/api/clients', requireAuth, async (_, res) => {
  const clients = await readClients();
  const today = new Date().toISOString().slice(0, 10);
  for (const c of clients) if (c.dueDate) c.status = c.dueDate < today ? 'Inactive' : 'Active';
  await writeClients(clients);
  res.json(clients);
});

app.post('/api/clients', requireAuth, async (req, res) => {
  const { name, phone, plan, location, installDate, billingCycle } = req.body;
  if (!name || !phone || !installDate) return res.status(400).json({ error: 'Missing fields' });

  const cycle = parseInt(billingCycle || 30, 10);
  const nextDue = new Date(installDate);
  nextDue.setDate(nextDue.getDate() + cycle);

  const clients = await readClients();
  const newClient = {
    id: uuidv4(),
    name, phone, plan, location,
    installDate, billingCycle: cycle,
    dueDate: formatDateISO(nextDue),
    status: 'Active',
    createdAt: new Date().toISOString()
  };
  clients.push(newClient);
  await writeClients(clients);
  res.json(newClient);
});

// 💰 Payment
app.post('/api/clients/:id/pay', requireAuth, async (req, res) => {
  const clients = await readClients();
  const client = clients.find(c => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const cycle = parseInt(client.billingCycle || 30, 10);
  const next = new Date(client.dueDate || Date.now());
  next.setDate(next.getDate() + cycle);
  client.dueDate = formatDateISO(next);
  client.status = 'Active';
  await writeClients(clients);

  const notif = {
    id: uuidv4(),
    time: new Date().toISOString(),
    clientId: client.id,
    clientName: client.name,
    message: `${client.name} marked as paid. Next due: ${client.dueDate}`,
  };
  await appendNotif(notif);
  io.emit('notification', notif);

  res.json({ ok: true });
});

// 🗑 Delete
app.delete('/api/clients/:id', requireAuth, async (req, res) => {
  const clients = await readClients();
  const idx = clients.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const removed = clients.splice(idx, 1)[0];
  await writeClients(clients);
  res.json({ ok: true, removed });
});

// 🔔 Notifications
app.get('/api/notifications', requireAuth, async (_, res) => res.json(await readNotifs()));
app.delete('/api/notifications/clear', requireAuth, async (_, res) => {
  await fs.writeFile(NOTIFS_FILE, '[]');
  res.json({ ok: true });
});

// 🧪 Test Email
app.post('/api/test-email', requireAuth, async (_, res) => {
  try {
    await sendEmail('✅ Test Email from Brylle’s Network Panel',
      '<b>Your Render + Resend setup is working!</b>');
    res.json({ ok: true, message: 'Test email sent!' });
  } catch (err) {
    console.error('Test email failed:', err);
    res.status(500).json({ error: 'Email test failed' });
  }
});

// 🔐 Login
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

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// 📂 Static
app.use(express.static(path.join(__dirname, 'public')));

// ===== Start =====
(async () => {
  await ensureDataFiles();
  const port = process.env.PORT || 10000;
  server.listen(port, () => console.log(`✅ Running on ${port}`));

  io.on('connection', s => console.log('Socket connected:', s.id));
  cron.schedule('0 8 * * *', () => console.log('⏰ Daily check triggered'), { timezone: 'Asia/Manila' });
})();
