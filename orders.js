// Orders page logic (ESM via CDN Firebase)
import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore, collection, onSnapshot, orderBy, query, updateDoc, doc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { auth } from './auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyA7xio2a_7-9ZZTqN7Uc3ZIzipZYnnYj6k",
  authDomain: "pos-system-fa07b.firebaseapp.com",
  projectId: "pos-system-fa07b",
  storageBucket: "pos-system-fa07b.firebasestorage.app",
  messagingSenderId: "88080946373",
  appId: "1:88080946373:web:07bb37c5d8b228de638cac"
};

let app;
try { app = getApps().length ? getApp() : initializeApp(firebaseConfig); } catch (e) { app = initializeApp(firebaseConfig, 'orders-app'); }
const db = getFirestore(app);

const ordersGrid = document.getElementById('orders-grid');
const emptyEl = document.getElementById('empty-orders');
const countEl = document.getElementById('orders-count');
const filtersEl = document.getElementById('status-filters');

let allOrders = []; // cache snapshot
let currentFilter = 'cooking'; // default to Preparing
let timerId = null;

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getStartMs(data) {
  if (data.timestamp?.toDate) return data.timestamp.toDate().getTime();
  if (typeof data.timestamp === 'number') return data.timestamp;
  const parsed = Date.parse(data.createdAt || data.startedAt || '');
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function getStopMsIfDone(data) {
  if (data.status === 'served' || data.status === 'cancelled') {
    if (data.statusUpdatedAt?.toDate) return data.statusUpdatedAt.toDate().getTime();
    if (typeof data.statusUpdatedAt === 'number') return data.statusUpdatedAt;
  }
  return null;
}

function renderOrderCard(id, data, now = Date.now()) {
  const startMs = getStartMs(data);
  const stopMs = getStopMsIfDone(data);
  const elapsed = (stopMs ?? now) - startMs;
  const itemsHTML = (data.items || [])
    .map(it => `<div class="flex justify-between text-sm"><span>${it.name} <span class="text-xs text-gray-500">x${it.quantity}</span></span><span class="font-semibold">₱${(it.price * it.quantity).toFixed(2)}</span></div>`)
    .join('');

  const statusColor = data.status === 'served' ? 'text-emerald-700' : data.status === 'cancelled' ? 'text-rose-700' : 'text-amber-700';
  const statusBg = data.status === 'served' ? 'bg-emerald-50 border-emerald-200' : data.status === 'cancelled' ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200';

  const card = document.createElement('div');
  card.className = `glass-container rounded-xl p-4 border ${statusBg}`;
  card.setAttribute('data-order-id', id);
  card.setAttribute('data-status', data.status || 'cooking');
  card.innerHTML = `
    <div class="flex items-start justify-between mb-2">
      <div>
        <div class="text-xs text-gray-500">Receipt ${data.receiptNumber || ''}</div>
        <div class="font-bold">₱${Number(data.totalAmount || 0).toFixed(2)}</div>
      </div>
      <select data-id="${id}" class="status-select px-3 py-1 border border-gray-300 rounded-lg text-sm bg-white">
        <option value="cooking" ${data.status === 'cooking' ? 'selected' : ''}>Preparing</option>
        <option value="served" ${data.status === 'served' ? 'selected' : ''}>Served</option>
        <option value="cancelled" ${data.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
      </select>
    </div>
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs ${statusColor} font-semibold capitalize">${data.status || 'cooking'}</span>
      <span class="timer text-sm font-mono px-2 py-1 rounded-xl bg-gray-50 border border-gray-200 text-gray-800">${fmtElapsed(elapsed)}</span>
    </div>
    <div class="space-y-1">${itemsHTML || '<div class="text-sm text-gray-500">No items</div>'}</div>
    <div class="mt-2 space-y-0.5">
      <div class="text-xs text-gray-500">Attendant: ${data.cashier || '—'}</div>
      <div class="text-xs text-gray-500">Paid via ${data.paymentMethod || 'cash'}</div>
    </div>
  `;
  return card;
}

function bindStatusHandlers() {
  ordersGrid.querySelectorAll('select.status-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const id = e.target.getAttribute('data-id');
      const status = e.target.value;
      try {
        await updateDoc(doc(db, 'orders', id), { status, statusUpdatedAt: serverTimestamp() });
      } catch (err) {
        console.error('Failed to update status', err);
        alert('Failed to update status');
      }
    });
  });
}

function applyFilterAndRender() {
  const now = Date.now();
  ordersGrid.innerHTML = '';
  const filtered = currentFilter === 'all' ? allOrders : allOrders.filter(o => (o.data.status || 'cooking') === currentFilter);
  if (!filtered.length) {
    emptyEl.classList.remove('hidden');
    countEl.textContent = '';
  } else {
    emptyEl.classList.add('hidden');
    filtered.forEach(o => {
      const card = renderOrderCard(o.id, o.data, now);
      ordersGrid.appendChild(card);
    });
    countEl.textContent = `${filtered.length} order${filtered.length === 1 ? '' : 's'}`;
  }
  bindStatusHandlers();
}

function tickTimers() {
  const now = Date.now();
  // Update only Preparing timers
  ordersGrid.querySelectorAll('[data-status="cooking"]').forEach(card => {
    const id = card.getAttribute('data-order-id');
    const order = allOrders.find(o => o.id === id);
    if (!order) return;
    const elapsed = now - getStartMs(order.data);
    const timerEl = card.querySelector('.timer');
    if (timerEl) timerEl.textContent = fmtElapsed(elapsed);
  });
}

function subscribeOrders() {
  const q = query(collection(db, 'orders'), orderBy('timestamp', 'desc'));
  return onSnapshot(q, (snap) => {
    allOrders = [];
    snap.forEach(docu => { allOrders.push({ id: docu.id, data: docu.data() }); });
    applyFilterAndRender();
  }, (err) => {
    console.error('Failed to fetch orders', err);
  });
}

function setupFilters() {
  if (!filtersEl) return;
  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    currentFilter = btn.getAttribute('data-filter');
    // active styles
    filtersEl.querySelectorAll('button[data-filter]').forEach(b => b.classList.remove('ring-2', 'ring-gray-400'));
    btn.classList.add('ring-2', 'ring-gray-400');
    applyFilterAndRender();
  });
}

let unsub;
document.addEventListener('DOMContentLoaded', () => {
  unsub = subscribeOrders();
  setupFilters();
  // default highlight for Preparing
  const prepBtn = document.querySelector('#status-filters [data-filter="cooking"]');
  if (prepBtn) prepBtn.classList.add('ring-2', 'ring-gray-400');
  timerId = setInterval(tickTimers, 1000);
});

window.addEventListener('beforeunload', () => {
  if (unsub) unsub();
  if (timerId) clearInterval(timerId);
});
