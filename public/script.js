// === ADMIN PANEL LOGIC ===
const api = (url, opts) => fetch(url, opts).then(async r => {
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'Request failed');
  }
  return r.json();
});

const els = {
  name: document.getElementById('name'),
  phone: document.getElementById('phone'),
  plan: document.getElementById('plan'),
  location: document.getElementById('location'),
  installDate: document.getElementById('installDate'),
  billingCycle: document.getElementById('billingCycle'),
  addBtn: document.getElementById('addBtn'),
  runCheck: document.getElementById('runCheck'),
  clientsTable: document.querySelector('#clientsTable tbody'),
  totalBadge: document.getElementById('totalBadge'),
  cardTotal: document.getElementById('cardTotal'),
  cardActive: document.getElementById('cardActive'),
  cardDueSoon: document.getElementById('cardDueSoon'),
  cardOverdue: document.getElementById('cardOverdue'),
  search: document.getElementById('search'),
  navDashboard: document.getElementById('nav-dashboard'),
  navClients: document.getElementById('nav-clients'),
  navNotifs: document.getElementById('nav-notifs'),
  dashboardView: document.getElementById('dashboardView'),
  clientsView: document.getElementById('clientsView'),
  notifsView: document.getElementById('notifsView'),
  exportJson: document.getElementById('exportJson'),
  navLogout: document.getElementById('nav-logout'),
  toast: document.getElementById('toast'),
  notifs: document.getElementById('notifs'),
  loadAllNotifs: document.getElementById('loadAllNotifs')
};

// === Toast ===
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.style.display = 'block';
  setTimeout(() => (els.toast.style.display = 'none'), 3000);
}

// === Play Sound ===
function playSound() {
  const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/233/233-preview.mp3");
 // place notify.mp3 inside /public
  audio.volume = 0.6;
  audio.play().catch(() => {});
}

// === View Switch ===
function switchView(v) {
  els.dashboardView.style.display = v === 'dashboard' ? '' : 'none';
  els.clientsView.style.display = v === 'clients' ? '' : 'none';
  els.notifsView.style.display = v === 'notifications' ? '' : 'none';
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  if (v === 'dashboard') els.navDashboard.classList.add('active');
  if (v === 'clients') els.navClients.classList.add('active');
  if (v === 'notifications') els.navNotifs.classList.add('active');
}

// === Navigation ===
els.navDashboard.onclick = e => { e.preventDefault(); switchView('dashboard'); };
els.navClients.onclick = e => { e.preventDefault(); switchView('clients'); loadClients(); };
els.navNotifs.onclick = e => { e.preventDefault(); switchView('notifications'); loadNotifications(); };

// === Load Clients ===
async function loadClients(q) {
  const clients = await api('/api/clients');
  let list = q ? clients.filter(c =>
    (c.name || '').toLowerCase().includes(q.toLowerCase()) ||
    (c.phone || '').includes(q)
  ) : clients;

  els.clientsTable.innerHTML = '';
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(); soon.setDate(soon.getDate() + 3);
  const soonStr = soon.toISOString().slice(0, 10);

  let active = 0, dueSoon = 0, overdue = 0;
  list.forEach(c => {
    const isOverdue = c.dueDate < today;
    const status = isOverdue ? 'Inactive' : 'Active';
    if (status === 'Active') active++;
    if (isOverdue) overdue++;
    if (c.dueDate >= today && c.dueDate <= soonStr && status === 'Active') dueSoon++;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${c.phone}</td>
      <td>${c.plan}</td>
      <td>${c.location || ''}</td>
      <td>${c.installDate || ''}</td>
      <td>${c.dueDate || ''}</td>
      <td style="color:${status === 'Active' ? '#4ade80' : '#f87171'};font-weight:600">${status}</td>
      <td>
        <button class="btn payBtn" data-id="${c.id}">Paid</button>
        <button class="btn deleteBtn" data-id="${c.id}" style="background:#b33">Delete</button>
      </td>`;
    els.clientsTable.appendChild(tr);
  });

  els.totalBadge.textContent = list.length;
  els.cardTotal.textContent = list.length;
  els.cardActive.textContent = active;
  els.cardDueSoon.textContent = dueSoon;
  els.cardOverdue.textContent = overdue;

  // === Delete Button ===
  document.querySelectorAll('.deleteBtn').forEach(btn => btn.onclick = async () => {
    if (!confirm('Delete this client?')) return;
    await api(`/api/clients/${btn.dataset.id}`, { method: 'DELETE' });
    showToast('Client deleted');
    loadClients(els.search.value.trim());
  });

  // === Paid Button ===
  document.querySelectorAll('.payBtn').forEach(btn => btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Processing...';
    try {
      const res = await api(`/api/clients/${btn.dataset.id}/pay`, { method: 'POST' });
      showToast(res.message || 'Marked as paid');
      playSound();
      loadClients();
      loadNotifications();
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Paid';
      }, 10000); // 10s disable
    } catch (err) {
      console.error(err);
      showToast('Error processing payment');
      btn.disabled = false;
      btn.textContent = 'Paid';
    }
  });
}

// === Add Client ===
els.addBtn.onclick = async () => {
  const name = els.name.value.trim();
  const phone = els.phone.value.trim();
  const plan = els.plan.value;
  const location = els.location.value;
  const installDate = els.installDate.value;
  const billingCycle = parseInt(els.billingCycle.value, 10) || 30;

  if (!name || !phone || !installDate)
    return showToast('Please fill all required fields.');

  await api('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone, plan, location, installDate, billingCycle })
  });

  showToast('Client added');
  playSound();
  els.name.value = els.phone.value = els.installDate.value = '';
  loadClients();
};

// === Run Check (with sound + email + popup) ===
els.runCheck.onclick = async () => {
  showToast('🔍 Running check and sending test email...');
  playSound();

  try {
    const res = await api('/api/test-email', { method: 'POST' });
    showToast(res.message || '✅ Email sent successfully!');
    playSound();

    // Optional: popup alert for visibility
    alert('✅ Email sent successfully! Check your Gmail inbox.');
  } catch (err) {
    console.error(err);
    showToast('❌ Email failed to send.');
    alert('❌ Email failed. Please check your Gmail credentials.');
  }
};


// === Notifications (with scroll + clear all) ===
async function loadNotifications() {
  const notifs = await api('/api/notifications');
  els.notifs.innerHTML = notifs.length
    ? notifs.map(n => `
      <div class="notif-item">
        <div><strong>${n.clientName}</strong> (${n.dueDate})</div>
        <div class="small">${n.message}</div>
      </div>`).join('')
    : '<div class="small">No notifications yet.</div>';

  if (notifs.length) {
    const clearBtn = document.createElement('button');
    clearBtn.id = 'clearAllBtn';
    clearBtn.textContent = 'Clear All Notifications';
    clearBtn.onclick = async () => {
      if (!confirm('Clear all notifications?')) return;
      await api('/api/notifications/clear', { method: 'DELETE' });
      showToast('Notifications cleared');
      loadNotifications();
    };
    els.notifs.appendChild(clearBtn);
  }
}

// === Logout ===
els.navLogout.onclick = async e => {
  e.preventDefault();
  await fetch('/logout', { method: 'POST' });
  location.href = '/login.html';
};

// === Search ===
els.search.oninput = () => loadClients(els.search.value.trim());

// === Browser Notifications ===
if (Notification && Notification.permission !== "granted") Notification.requestPermission();

function showBrowserNotification(title, body) {
  if (Notification.permission === "granted") new Notification(title, { body, icon: "logo.svg" });
}

async function checkDueNotifications() {
  try {
    const clients = await api('/api/clients');
    const now = new Date();
    clients.forEach(c => {
      if (!c.dueDate) return;
      const due = new Date(c.dueDate);
      const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

      if (diffDays === 5) showBrowserNotification("Upcoming Due Date", `${c.name} is due in 5 days (${c.dueDate})`);
      if (diffDays === 0) showBrowserNotification("Due Today", `${c.name} is due today! (${c.dueDate})`);
      if (diffDays < 0) {
        showBrowserNotification("Overdue Client", `${c.name} is overdue since ${c.dueDate}`);
        playSound();
      }
    });
  } catch (err) { console.error("Notification check failed:", err); }
}

// === Auto Refresh ===
setInterval(loadClients, 30000);
setInterval(checkDueNotifications, 60000);
checkDueNotifications();

loadClients();
switchView('dashboard');
// 🔁 Auto-refresh every 60 seconds
setInterval(() => {
  fetchClients(); // or reload client data function
}, 60000);

