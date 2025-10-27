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
  dueDate: document.getElementById('dueDate'),
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

// === Toast Message Display ===
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.style.display = 'block';
  setTimeout(() => els.toast.style.display = 'none', 3000);
}

// === Switch Between Views ===
function switchView(v) {
  els.dashboardView.style.display = v === 'dashboard' ? '' : 'none';
  els.clientsView.style.display = v === 'clients' ? '' : 'none';
  els.notifsView.style.display = v === 'notifications' ? '' : 'none';
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  if (v === 'dashboard') els.navDashboard.classList.add('active');
  if (v === 'clients') els.navClients.classList.add('active');
  if (v === 'notifications') els.navNotifs.classList.add('active');
}

// === View Navigation ===
els.navDashboard.onclick = e => { e.preventDefault(); switchView('dashboard'); };
els.navClients.onclick = e => { e.preventDefault(); switchView('clients'); loadClients(); };
els.navNotifs.onclick = e => { e.preventDefault(); switchView('notifications'); loadNotifications(); };

// === Load All Clients ===
async function loadClients(q) {
  const clients = await api('/api/clients');
  let list = clients;
  if (q) list = clients.filter(c =>
    (c.name || '').toLowerCase().includes(q.toLowerCase()) ||
    (c.phone || '').includes(q)
  );

  els.clientsTable.innerHTML = '';
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(); soon.setDate(soon.getDate() + 3);
  const soonStr = soon.toISOString().slice(0, 10);

  let active = 0, dueSoon = 0, overdue = 0;
  list.forEach(c => {
    if (c.status !== 'Paid') active++;
    if (c.dueDate < today && c.status !== 'Paid') overdue++;
    if (c.dueDate >= today && c.dueDate <= soonStr && c.status !== 'Paid') dueSoon++;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${c.phone}</td>
      <td>${c.plan}</td>
      <td>${c.location || ''}</td>
      <td>${c.installDate || ''}</td>
      <td>${c.dueDate || ''}</td>
      <td>${c.status}</td>
      <td>
        ${c.status !== 'Paid' ? `<button class="btn payBtn" data-id="${c.id}">Paid</button>` : ''}
        <button class="btn deleteBtn" data-id="${c.id}" style="background:#b33">Delete</button>
      </td>`;
    els.clientsTable.appendChild(tr);
  });

  els.totalBadge.textContent = list.length;
  els.cardTotal.textContent = list.length;
  els.cardActive.textContent = active;
  els.cardDueSoon.textContent = dueSoon;
  els.cardOverdue.textContent = overdue;

  // Delete client
  document.querySelectorAll('.deleteBtn').forEach(btn => btn.onclick = async e => {
    if (!confirm('Delete this client?')) return;
    const id = btn.dataset.id;
    try {
      await api(`/api/clients/${id}`, { method: 'DELETE' });
      showToast('Client deleted');
      loadClients(els.search.value.trim());
    } catch (err) {
      showToast(err.message);
    }
  });

  // Mark client as paid
  document.querySelectorAll('.payBtn').forEach(btn => btn.onclick = async e => {
    const id = btn.dataset.id;
    try {
      await api(`/api/clients/${id}/pay`, { method: 'POST' });
      showToast('Marked as paid');
      loadClients();
    } catch (err) {
      showToast(err.message);
    }
  });
}

// === Add New Client ===
els.addBtn.onclick = async () => {
  const name = els.name.value.trim();
  const phone = els.phone.value.trim();
  const plan = els.plan.value;
  const dueDate = els.dueDate.value;
  const location = document.getElementById('location').value.trim();
  const installDate = document.getElementById('installDate').value.trim();

  if (!name || !phone || !dueDate) return showToast('Fill all required fields');

  await api('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone, plan, dueDate, location, installDate })
  });
  showToast('Client added');
  els.name.value = els.phone.value = els.location = els.dueDate.value = '';
  loadClients();
};

// === Run Check Now Button ===
els.runCheck.onclick = async () => {
  showToast('Running due-date check...');
  try {
    const res = await api('/api/run-check-now', { method: 'POST' });
    showToast(res.message || 'Check completed!');
    await loadClients();
    await loadNotifications();
  } catch (err) {
    console.error(err);
    showToast('Error running check.');
  }
};

// === Load Notifications ===
async function loadNotifications() {
  const notifs = await api('/api/notifications');
  els.notifs.innerHTML = notifs.length
    ? notifs.map(n => `
        <div class="notif-item">
          <div><strong>${n.clientName}</strong> (${n.dueDate})</div>
          <div class="small">${n.message}</div>
        </div>
      `).join('')
    : '<div class="small">No notifications yet.</div>';
}

// === Logout ===
els.navLogout.onclick = async e => {
  e.preventDefault();
  await fetch('/logout', { method: 'POST' });
  location.href = '/login.html';
};

// === Search Clients ===
els.search.oninput = () => loadClients(els.search.value.trim());

// === Browser Notifications for Due Dates ===
if (Notification && Notification.permission !== "granted") {
  Notification.requestPermission();
}

function showBrowserNotification(title, body) {
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "logo.svg" });
  }
}

async function checkDueNotifications() {
  try {
    const clients = await api('/api/clients');
    const now = new Date();
    const soon = new Date();
    soon.setDate(now.getDate() + 5);

    clients.forEach(c => {
      if (!c.dueDate || c.status === "Paid") return;
      const due = new Date(c.dueDate);
      const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

      if (diffDays === 5) {
        showBrowserNotification("Upcoming Due Date", `${c.name} is due in 5 days (${c.dueDate})`);
      }
      if (diffDays === 0) {
        showBrowserNotification("Due Today", `${c.name} is due today! (${c.dueDate})`);
      }
      if (diffDays < 0) {
        showBrowserNotification("Overdue Client", `${c.name} is overdue since ${c.dueDate}`);
      }
    });
  } catch (err) {
    console.error("Notification check failed:", err);
  }
}

// Run notification check every 1 minute
setInterval(checkDueNotifications, 60000);
checkDueNotifications();

// === Initial Load ===
loadClients();
switchView('dashboard');
