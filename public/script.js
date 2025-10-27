// admin pro script - login required; supports delete, search, toasts
const api = (path, opts) => fetch(path, opts).then(async r=>{ if(!r.ok){ const body = await r.json().catch(()=>({error:'Request failed'})); throw new Error(body.error||'Request failed'); } return r.json(); });

const els = {
  name: document.getElementById('name'), phone: document.getElementById('phone'), plan: document.getElementById('plan'), dueDate: document.getElementById('dueDate'),
  addBtn: document.getElementById('addBtn'), runCheck: document.getElementById('runCheck'), clientsTable: document.querySelector('#clientsTable tbody'),
  summary: document.getElementById('summary'), totalBadge: document.getElementById('totalBadge'), notifs: document.getElementById('notifs'),
  loadAllNotifs: document.getElementById('loadAllNotifs'), cardTotal: document.getElementById('cardTotal'), cardActive: document.getElementById('cardActive'),
  cardDueSoon: document.getElementById('cardDueSoon'), cardOverdue: document.getElementById('cardOverdue'), search: document.getElementById('search'),
  navDashboard: document.getElementById('nav-dashboard'), navClients: document.getElementById('nav-clients'), navNotifs: document.getElementById('nav-notifs'),
  dashboardView: document.getElementById('dashboardView'), clientsView: document.getElementById('clientsView'), notifsView: document.getElementById('notifsView'),
  exportJson: document.getElementById('exportJson'), navLogout: document.getElementById('nav-logout'), toast: document.getElementById('toast')
};

function showToast(msg){ els.toast.textContent = msg; els.toast.style.display='block'; setTimeout(()=>els.toast.style.display='none',3500); }

function switchView(v){ els.dashboardView.style.display = v==='dashboard' ? '' : 'none'; els.clientsView.style.display = v==='clients' ? '' : 'none'; els.notifsView.style.display = v==='notifications' ? '' : 'none'; document.querySelectorAll('.nav a').forEach(a=>a.classList.remove('active')); if(v==='dashboard') els.navDashboard.classList.add('active'); if(v==='clients') els.navClients.classList.add('active'); if(v==='notifications') els.navNotifs.classList.add('active'); }

els.navDashboard.addEventListener('click',e=>{e.preventDefault(); switchView('dashboard');});
els.navClients.addEventListener('click',e=>{e.preventDefault(); switchView('clients');});
els.navNotifs.addEventListener('click',e=>{e.preventDefault(); switchView('notifications');});

async function loadClients(q){ try{ const clients = await api('/api/clients'); let list = clients; if(q){ const qq = q.toLowerCase(); list = clients.filter(c=> (c.name||'').toLowerCase().includes(qq) || (c.phone||'').toLowerCase().includes(qq) ); } els.clientsTable.innerHTML=''; let total = list.length, active=0, paid=0, dueSoon=0, overdue=0; const today = new Date().toISOString().slice(0,10); const soon = new Date(); soon.setDate(soon.getDate()+3); const soonStr = soon.toISOString().slice(0,10); for(const c of list){ if(c.status==='Paid') paid++; else active++; if(c.dueDate && c.dueDate <= soonStr && c.dueDate >= today && c.status!=='Paid') dueSoon++; if(c.dueDate && c.dueDate < today && c.status!=='Paid') overdue++; const tr = document.createElement('tr'); tr.innerHTML = `
      <td>${c.name}</td><td>${c.phone}</td><td>${c.plan||''}</td><td>${c.dueDate||''}</td><td>${c.status||''}</td>
      <td>
        ${c.status!=='Paid' ? '<button data-id="'+c.id+'" class="payBtn btn">Mark Paid</button>' : ''}
        <button data-id="${c.id}" class="delete-btn">Delete</button>
      </td>`; els.clientsTable.appendChild(tr); } els.summary.textContent = `Total: ${total} • Active: ${active} • Paid: ${paid} • Overdue: ${overdue}`; els.totalBadge.textContent = total; els.cardTotal.textContent = total; els.cardActive.textContent = active; els.cardDueSoon.textContent = dueSoon; els.cardOverdue.textContent = overdue; document.querySelectorAll('.payBtn').forEach(b=>b.addEventListener('click',async ev=>{ const id = ev.target.getAttribute('data-id'); try{ await api(`/api/clients/${id}/pay`, { method:'POST' }); showToast('Marked paid'); loadClients(els.search.value.trim()); }catch(e){ showToast(e.message); } })); document.querySelectorAll('.delete-btn').forEach(b=>b.addEventListener('click',async ev=>{ const id = ev.target.getAttribute('data-id'); if(!confirm('Delete this client? This cannot be undone.')) return; try{ await api(`/api/clients/${id}`, { method:'DELETE' }); showToast('Client deleted'); loadClients(els.search.value.trim()); }catch(e){ showToast(e.message); } })); }catch(e){ console.error(e); els.summary.textContent = 'Unable to load clients.'; } }

els.addBtn.addEventListener('click', async ()=>{ const name = els.name.value.trim(); const phone = els.phone.value.trim(); const plan = els.plan.value.trim(); const dueDate = els.dueDate.value; if(!name) return showToast('Enter client name'); if(!phone) return showToast('Enter phone'); if(!dueDate) return showToast('Select due date'); try{ await api('/api/clients', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, phone, plan, dueDate }) }); els.name.value=''; els.phone.value=''; els.plan.value=''; els.dueDate.value=''; showToast('Client added'); loadClients(); }catch(e){ showToast('Error: '+e.message); } });

els.runCheck.addEventListener('click', async ()=>{ try{ await api('/api/run-check-now', { method:'POST' }); showToast('Check executed'); }catch(e){ showToast('Error running check'); } });

els.search.addEventListener('input', ()=> loadClients(els.search.value.trim()));

els.loadAllNotifs.addEventListener('click', async ()=>{ try{ const notifs = await api('/api/notifications'); if(!notifs.length){ els.notifs.innerHTML = '<div class="small">No notifications yet.</div>'; return; } els.notifs.innerHTML = notifs.map(n=>`<div class="notif"><strong>${n.clientName}</strong> <div class="small">${new Date(n.time).toLocaleString()}</div><div style="margin-top:6px">${n.message}</div><div class="small">SMS: ${n.sms? n.sms.method: 'n/a'}</div></div>`).join(''); }catch(e){ showToast('Unable to load notifications'); } });

els.exportJson.addEventListener('click', async ()=>{ try{ const clients = await api('/api/clients'); const blob = new Blob([JSON.stringify(clients, null,2)], { type:'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='clients.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }catch(e){ showToast('Export error'); } });

els.navLogout.addEventListener('click', async (e)=>{ e.preventDefault(); await fetch('/logout', { method:'POST' }); window.location = '/login.html'; });

// socket real-time
const socket = io();
socket.on('notification', n=>{ const el = document.createElement('div'); el.className='notif'; el.innerHTML = `<strong>${n.clientName}</strong> <div class="small">${new Date(n.time).toLocaleString()}</div><div style="margin-top:6px">${n.message}</div><div class="small">SMS: ${n.sms ? n.sms.method : 'n/a'}</div>`; els.notifs.prepend(el); loadClients(); showToast('Notification'); });

// initial load
loadClients();
switchView('dashboard');
