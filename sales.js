// sales.js - Sales Dashboard functionality for DaxSilog POS System

import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, query, where, orderBy, limit, getDocs, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// Firebase configuration - same as in script.js
const firebaseConfig = {
    apiKey: "AIzaSyA7xio2a_7-9ZZTqN7Uc3ZIzipZYnnYj6k",
    authDomain: "pos-system-fa07b.firebaseapp.com",
    projectId: "pos-system-fa07b",
    storageBucket: "pos-system-fa07b.firebasestorage.app",
    messagingSenderId: "88080946373",
    appId: "1:88080946373:web:07bb37c5d8b228de638cac"
};

// Initialize Firebase (check if already initialized)
let app;
try {
    if (getApps().length) {
        app = getApp();
        console.log("Using existing Firebase app");
    } else {
        app = initializeApp(firebaseConfig);
        console.log("Initialized new Firebase app");
    }
} catch (error) {
    console.error("Firebase initialization error:", error);
    try {
        app = initializeApp(firebaseConfig, "salesApp");
        console.log("Initialized Firebase app with name 'salesApp'");
    } catch (e) {
        console.error("Fatal Firebase initialization error:", e);
        alert("Could not initialize Firebase. Check console for details.");
    }
}

const db = getFirestore(app);
const auth = getAuth(app);

// Configure Firestore for better offline handling
try {
    if (typeof db.settings === 'function') {
        db.settings({
            cacheSizeBytes: 50000000, // 50 MB
            ignoreUndefinedProperties: true,
            experimentalForceLongPolling: true
        });
    }
} catch (_) { /* no-op */ }

// DOM elements
const dateFromInput = document.getElementById('date-from');
const dateToInput = document.getElementById('date-to');
const applyDateFilterBtn = document.getElementById('apply-date-filter');
const exportSalesBtn = document.getElementById('export-sales');
const offlineIndicator = document.getElementById('offline-indicator');
const receiptViewModal = document.getElementById('receipt-view-modal');
const closeReceiptViewBtn = document.getElementById('close-receipt-view-btn');
const printReceiptBtn = document.getElementById('print-receipt-btn');
const receiptViewDetails = document.getElementById('receipt-view-details');
const receiptViewNumber = document.getElementById('receipt-view-number');

// Set up Chart.js
let salesChart;
// Track active real-time subscription
let unsubscribeSales = null;
let unsubscribeOrders = null;
// Debounce timer for chart updates to avoid thrashing on rapid snapshots
let chartUpdateTimer = null;
// Orders status map by receiptNumber
let ordersStatusByReceipt = new Map();
// Last sales snapshot cached for re-rendering when status changes
let latestSalesData = [];

// Network status monitoring
function updateNetworkStatus() {
    if (navigator.onLine) {
        offlineIndicator.classList.add('hidden');
    } else {
        offlineIndicator.classList.remove('hidden');
    }
}

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', () => {
    // Monitor network status
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    updateNetworkStatus();

    // Set default date range (last 7 days); ensure "To" is today
    const today = new Date();
    const todayStr = formatLocalDate(today);
    const weekAgo = new Date();
    weekAgo.setDate(today.getDate() - 7);
    const weekAgoStr = formatLocalDate(weekAgo);

    if (dateToInput) {
        dateToInput.value = todayStr; // force To to current day to avoid timezone drift
        dateToInput.max = todayStr;   // prevent selecting future dates
    }
    if (dateFromInput) {
        dateFromInput.value = weekAgoStr;
        dateFromInput.max = todayStr;
    }

    // Make sure chart elements are in the right state before initialization
    const chartLoading = document.getElementById('chart-loading');
    const chartEmpty = document.getElementById('chart-empty');
    const salesChartCanvas = document.getElementById('sales-chart');
    
    if (chartLoading) chartLoading.classList.remove('hidden');
    if (chartEmpty) chartEmpty.classList.add('hidden');
    if (salesChartCanvas) salesChartCanvas.classList.add('hidden');

    // Initialize sales chart with a slight delay to ensure DOM is ready
    setTimeout(() => {
        initializeSalesChart();
    }, 100);
    
    // Do NOT load data yet; wait for auth state to be ready

    // Set up event listeners
    setupEventListeners();

    // Check authentication state
    checkAuthState();
});

// Check if user is authenticated
function checkAuthState() {
    onAuthStateChanged(auth, (user) => {
        const signinLink = document.getElementById('signin-link');
        const logoutBtn = document.getElementById('logout-btn');
        const logoutBtnDesktop = document.getElementById('logout-btn-desktop');

        if (user) {
            // User is signed in
            if (signinLink) signinLink.classList.add('hidden');
            if (logoutBtn) logoutBtn.classList.remove('hidden');
            if (logoutBtnDesktop) logoutBtnDesktop.classList.remove('hidden');

            // Now that auth is available, load sales data (real-time)
            loadSalesData();
        } else {
            // User is signed out
            if (signinLink) signinLink.classList.remove('hidden');
            if (logoutBtn) logoutBtn.classList.add('hidden');
            if (logoutBtnDesktop) logoutBtnDesktop.classList.add('hidden');
        }
    });
}

// Set up event listeners
function setupEventListeners() {
    // Date filter
    applyDateFilterBtn.addEventListener('click', () => {
        // Ensure To is today if blank
        if (!dateToInput.value) {
            dateToInput.value = formatLocalDate(new Date());
        }
        // Resubscribe with new date range
        loadSalesData();
        // Chart will be updated by snapshot; no need to call separately
    });

    // Export sales
    exportSalesBtn.addEventListener('click', exportSalesData);

    // View receipt buttons
    document.querySelectorAll('.view-receipt-btn').forEach(button => {
        button.addEventListener('click', () => {
            const receiptId = button.dataset.receipt;
            viewReceiptDetails(receiptId);
        });
    });

    // Close receipt view modal
    closeReceiptViewBtn.addEventListener('click', () => {
        receiptViewModal.classList.add('hidden');
    });
    
    // Print receipt
    printReceiptBtn.addEventListener('click', printReceipt);

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (typeof unsubscribeSales === 'function') {
            unsubscribeSales();
            unsubscribeSales = null;
        }
        if (typeof unsubscribeOrders === 'function') {
            unsubscribeOrders();
            unsubscribeOrders = null;
        }
    });
}

// Initialize sales chart
function initializeSalesChart() {
    const ctx = document.getElementById('sales-chart').getContext('2d');
    
    // Initial empty chart that will be populated with real data
    salesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Daily Sales',
                data: [],
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderColor: 'rgba(37, 99, 235, 1)',
                borderWidth: 2,
                pointBackgroundColor: '#fff',
                pointBorderColor: 'rgba(37, 99, 235, 1)',
                pointBorderWidth: 2,
                pointRadius: 4,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    titleColor: '#1f2937',
                    bodyColor: '#4b5563',
                    borderColor: '#e5e7eb',
                    borderWidth: 1,
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return '₱' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '₱' + value;
                        }
                    }
                }
            }
        }
    });
}

// Update sales chart with new data
function updateSalesChart(salesData = []) {
    const { from: fromDate, to: toDate } = getDateRange();
    // Show loading indicator and hide other elements
    const chartLoading = document.getElementById('chart-loading');
    const chartEmpty = document.getElementById('chart-empty');
    const salesChartCanvas = document.getElementById('sales-chart');
    if (chartLoading) chartLoading.classList.remove('hidden');
    if (chartEmpty) chartEmpty.classList.add('hidden');
    if (salesChartCanvas) salesChartCanvas.classList.add('hidden');
    const labels = [];
    const data = [];
    const dailySales = new Map();
    let currentDate = new Date(fromDate);
    while (currentDate <= toDate) {
        const dateStr = currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        labels.push(dateStr);
        dailySales.set(dateStr, 0);
        const nextDate = new Date(currentDate);
        nextDate.setDate(currentDate.getDate() + 1);
        currentDate = nextDate;
    }
    salesData.forEach(sale => {
        if (sale.timestamp) {
            const saleDate = new Date(sale.timestamp.seconds ? sale.timestamp.seconds * 1000 : sale.timestamp);
            const dateStr = saleDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (dailySales.has(dateStr)) {
                // Exclude cancelled from chart totals
                if (getSaleStatus(sale) === 'cancelled') return;
                dailySales.set(dateStr, dailySales.get(dateStr) + (sale.total || 0));
            }
        }
    });
    labels.forEach(label => data.push(dailySales.get(label)));
    const hasRealData = data.some(value => value > 0);
    if (!hasRealData) {
        if (chartLoading) chartLoading.classList.add('hidden');
        if (chartEmpty) chartEmpty.classList.remove('hidden');
        if (salesChartCanvas) salesChartCanvas.classList.add('hidden');
        return;
    }
    if (chartLoading) chartLoading.classList.add('hidden');
    if (chartEmpty) chartEmpty.classList.add('hidden');
    if (salesChartCanvas) salesChartCanvas.classList.remove('hidden');
    salesChart.data.labels = labels;
    salesChart.data.datasets[0].data = data;
    salesChart.update();
}

// Render sales table with data (now includes Status column)
function renderSalesTable(salesData) {
    const tableBody = document.getElementById('sales-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    if (salesData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">No sales data found for the selected period.</td></tr>';
        const paginationInfo = document.getElementById('sales-pagination-info');
        if (paginationInfo) paginationInfo.textContent = 'Showing 0 of 0 sales';
        return;
    }
    
    salesData.forEach(sale => {
        const row = document.createElement('tr');
        
        // Format timestamp
        const timestamp = sale.timestamp instanceof Date ? 
            sale.timestamp : 
            new Date(sale.timestamp?.seconds ? sale.timestamp.seconds * 1000 : sale.timestamp || Date.now());
            
        const formattedDate = timestamp.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true
        });
        
        // Format items
        const itemsText = sale.items?.map(item => {
            return item.quantity > 1 ? 
                `${item.name} (${item.quantity})` : 
                item.name;
        }).join(', ') || 'N/A';
        
        // Payment method badge
        const method = (sale.paymentMethod || '').toLowerCase();
        const paymentMethodHtml = method === 'gcash' ? 
            '<span class="px-2 py-1 bg-green-50 text-green-700 rounded-md text-xs font-medium">GCash</span>' :
            '<span class="px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-medium">Cash</span>';
        
        const statusHtml = statusBadgeHtml(getSaleStatus(sale));
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-800">${sale.receiptNumber || sale.id}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formattedDate}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${itemsText}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${sale.cashier || sale.attendant || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${paymentMethodHtml}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">${statusHtml}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-800">₱${sale.total?.toFixed(2) || '0.00'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-center">
                <button class="view-receipt-btn text-blue-600 hover:text-blue-800" data-receipt="${sale.id}">View</button>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    // Re-attach event listeners
    document.querySelectorAll('.view-receipt-btn').forEach(button => {
        button.addEventListener('click', () => {
            const receiptId = button.dataset.receipt;
            const sale = salesData.find(s => s.id === receiptId);
            viewReceiptDetails(receiptId, sale);
        });
    });
    
    // Update pagination text
    const paginationInfo = document.getElementById('sales-pagination-info');
    if (paginationInfo) {
        paginationInfo.textContent = 'Showing ' + Math.min(salesData.length, 5) + ' of ' + salesData.length + ' sales';
    }
}

// Update sales summary with data (subtract cancelled from Total Sales)
function updateSalesSummary(salesData) {
    const totalSales = salesData.reduce((sum, sale) => {
        const s = getSaleStatus(sale);
        if (s === 'cancelled') return sum; // exclude cancelled from revenue
        return sum + (sale.total || 0);
    }, 0);
    document.getElementById('total-sales-value').textContent = `₱${totalSales.toFixed(2)}`;
    document.getElementById('total-orders-value').textContent = salesData.length.toString();
    const avgOrder = salesData.length > 0 ? totalSales / salesData.length : 0;
    document.getElementById('avg-order-value').textContent = `₱${avgOrder.toFixed(2)}`;
    
    const paymentMethods = salesData.reduce((counts, sale) => {
        const method = sale.paymentMethod || 'cash';
        counts[method] = (counts[method] || 0) + 1;
        return counts;
    }, {});
    
    const totalOrders = salesData.length;
    const cashPercent = totalOrders > 0 ? Math.round((paymentMethods.cash || 0) * 100 / totalOrders) : 0;
    const gcashPercent = totalOrders > 0 ? Math.round((paymentMethods.gcash || 0) * 100 / totalOrders) : 0;
    
    document.getElementById('cash-percent').textContent = `${cashPercent}%`;
    document.getElementById('gcash-percent').textContent = `${gcashPercent}%`;
    document.getElementById('cash-progress').style.width = `${cashPercent}%`;
    document.getElementById('gcash-progress').style.width = `${gcashPercent}%`;
    
    const itemCounts = {};
    salesData.forEach(sale => {
        sale.items?.forEach(item => {
            const itemName = item.name;
            if (!itemCounts[itemName]) itemCounts[itemName] = { count: 0, total: 0 };
            itemCounts[itemName].count += (item.quantity || 1);
            itemCounts[itemName].total += (item.price || 0) * (item.quantity || 1);
        });
    });
    
    const sortedItems = Object.keys(itemCounts)
        .map(name => ({ name, ...itemCounts[name] }))
        .sort((a, b) => b.count - a.count);
    
    if (sortedItems.length > 0) {
        document.getElementById('best-seller-name').textContent = sortedItems[0].name;
        document.getElementById('best-seller-count').textContent = `${sortedItems[0].count} orders`;
    } else {
        document.getElementById('best-seller-name').textContent = '-';
        document.getElementById('best-seller-count').textContent = '-';
    }
    
    const topProductsContainer = document.getElementById('top-products-container');
    if (topProductsContainer) {
        topProductsContainer.innerHTML = '';
        if (sortedItems.length === 0) {
            topProductsContainer.innerHTML = `
                <div class="p-6 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                    <p class="text-gray-500">No products sold yet</p>
                    <p class="text-gray-400 text-sm mt-1">Complete sales to see top products</p>
                </div>
            `;
        } else {
            sortedItems.slice(0, 5).forEach((item, index) => {
                const productElement = document.createElement('div');
                productElement.className = 'flex items-center justify-between';
                productElement.innerHTML = `
                    <div class="flex items-center space-x-3">
                        <div class="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                            <span class="text-gray-600 text-xs">${index + 1}</span>
                        </div>
                        <div>
                            <p class="font-medium text-gray-800">${item.name}</p>
                            <p class="text-xs text-gray-500">${item.count} orders</p>
                        </div>
                    </div>
                    <p class="font-semibold text-gray-800">₱${item.total.toFixed(2)}</p>
                `;
                topProductsContainer.appendChild(productElement);
            });
        }
    }
}

// Helpers: parse YYYY-MM-DD from <input type="date"> as local dates
function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 0, 0, 0, 0); // local midnight
}
function formatLocalDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function getDateRange() {
    const from = parseLocalDate(dateFromInput.value) || new Date();
    const to = parseLocalDate(dateToInput.value) || new Date();
    to.setHours(23, 59, 59, 999);
    return { from, to };
}

// Status helpers and Orders subscription to derive sale status
function statusBadgeHtml(raw) {
    const s = (raw || '').toLowerCase();
    const label = s === 'cooking' ? 'Preparing' : s === 'waiting' ? 'Waiting' : s === 'ready' ? 'Ready' : s === 'served' ? 'Served' : s === 'cancelled' ? 'Cancelled' : '-';
    const cls = s === 'served' ? 'bg-green-50 text-green-700 border-green-300' :
               s === 'ready' ? 'bg-amber-50 text-amber-700 border-amber-300' :
               s === 'cooking' ? 'bg-blue-50 text-blue-700 border-blue-300' :
               s === 'waiting' ? 'bg-gray-50 text-gray-700 border-gray-300' :
               s === 'cancelled' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-gray-50 text-gray-500 border-gray-200';
    return `<span class="px-2 py-1 rounded-md text-xs font-medium border ${cls}">${label}</span>`;
}
function getSaleStatus(sale) {
    const direct = (sale && sale.status) ? String(sale.status).toLowerCase() : '';
    let s = direct;
    if (!s) {
        const rn = sale && sale.receiptNumber ? String(sale.receiptNumber) : '';
        if (rn && ordersStatusByReceipt.has(rn)) s = (ordersStatusByReceipt.get(rn) || '').toLowerCase();
    }
    // normalize US/UK spelling
    if (s === 'canceled') s = 'cancelled';
    return s;
}
function subscribeOrdersStatus(fromDate, toDate) {
    if (typeof unsubscribeOrders === 'function') {
        unsubscribeOrders();
        unsubscribeOrders = null;
    }
    try {
        const ordersQueryRef = query(
            collection(db, 'orders'),
            where('timestamp', '>=', fromDate),
            where('timestamp', '<=', toDate),
            orderBy('timestamp', 'desc'),
            limit(200)
        );
        unsubscribeOrders = onSnapshot(ordersQueryRef, (snapshot) => {
            const m = new Map();
            snapshot.forEach(docSnap => {
                const data = docSnap.data() || {};
                const rn = data.receiptNumber;
                if (rn) m.set(rn, data.status || '');
            });
            ordersStatusByReceipt = m;
            if (latestSalesData && latestSalesData.length) {
                renderSalesTable(latestSalesData);
                updateSalesSummary(latestSalesData);
            }
        }, (err) => {
            console.error('Orders status subscription failed:', err);
        });
    } catch (e) {
        console.error('Failed to subscribe to orders status:', e);
    }
}

// Load sales data from Firebase (real-time)
async function loadSalesData() {
    try {
        const { from: fromDate, to: toDate } = getDateRange();

        // Reset table to loading state
        const tableSalesBody = document.getElementById('sales-table-body');
        if (tableSalesBody) {
            tableSalesBody.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-6 text-center text-gray-500">
                        <div id="sales-loading" class="py-4">
                            <div class="inline-block animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-gray-900"></div>
                            <p class="mt-2 text-gray-600">Loading sales data...</p>
                        </div>
                    </td>
                </tr>
            `;
        }
        
        // Chart loading
        const chartLoading = document.getElementById('chart-loading');
        const chartEmpty = document.getElementById('chart-empty');
        const salesChartCanvas = document.getElementById('sales-chart');
        if (chartLoading) chartLoading.classList.remove('hidden');
        if (chartEmpty) chartEmpty.classList.add('hidden');
        if (salesChartCanvas) salesChartCanvas.classList.add('hidden');
        
        // Top products loading
        const topProductsContainer = document.getElementById('top-products-container');
        if (topProductsContainer) {
            topProductsContainer.innerHTML = `
                <div class="flex items-center justify-center p-6">
                    <div class="text-center">
                        <div class="inline-block animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-gray-900"></div>
                        <p class="mt-2 text-gray-600">Loading top products...</p>
                    </div>
                </div>
            `;
        }

        // If there is an existing subscription, unsubscribe first
        if (typeof unsubscribeSales === 'function') {
            unsubscribeSales();
            unsubscribeSales = null;
        }

        // Subscribe to orders status for this range
        subscribeOrdersStatus(fromDate, toDate);

        // Build query and subscribe in real-time
        const salesQuery = query(
            collection(db, "sales"),
            where("timestamp", ">=", fromDate),
            where("timestamp", "<=", toDate),
            orderBy("timestamp", "desc"),
            limit(50)
        );

        let firstEmissionHandled = false;
        // Fallback: if no snapshot within 2500ms, do a one-time fetch to display data
        let fallbackTimer = setTimeout(() => {
            if (!firstEmissionHandled) {
                loadSalesDataOnce(fromDate, toDate);
            }
        }, 2500);

        unsubscribeSales = onSnapshot(salesQuery, (snapshot) => {
            const salesData = [];
            snapshot.forEach((d) => salesData.push({ id: d.id, ...d.data() }));
            latestSalesData = salesData;

            // Render strictly from DB snapshot
            renderSalesTable(salesData);
            updateSalesSummary(salesData);
            // Debounce chart update slightly
            if (chartUpdateTimer) clearTimeout(chartUpdateTimer);
            chartUpdateTimer = setTimeout(() => updateSalesChart(salesData), 150);

            // Hide loading states on first emission
            if (!firstEmissionHandled) {
                firstEmissionHandled = true;
                clearTimeout(fallbackTimer);
                if (chartLoading) chartLoading.classList.add('hidden');
                if (salesData.length === 0) {
                    if (chartEmpty) chartEmpty.classList.remove('hidden');
                    if (salesChartCanvas) salesChartCanvas.classList.add('hidden');
                    if (tableSalesBody) {
                        tableSalesBody.innerHTML = '<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">No sales data found for the selected period.</td></tr>';
                    }
                } else {
                    if (chartEmpty) chartEmpty.classList.add('hidden');
                    if (salesChartCanvas) salesChartCanvas.classList.remove('hidden');
                }
            }
        }, (error) => {
            console.error("Error subscribing to sales data:", error);
            // Attempt one-time fetch on error
            loadSalesDataOnce(fromDate, toDate);
            const errorTableBody = document.getElementById('sales-table-body');
            if (errorTableBody) {
                errorTableBody.innerHTML = '<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">Failed to load sales data. Please try again.</td></tr>';
            }
            if (chartLoading) chartLoading.classList.add('hidden');
            if (chartEmpty) chartEmpty.classList.remove('hidden');
            if (salesChartCanvas) salesChartCanvas.classList.add('hidden');
            if (topProductsContainer) {
                topProductsContainer.innerHTML = `
                    <div class="p-6 text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                        </svg>
                        <p class="text-gray-500">No products sold yet</p>
                        <p class="text-gray-400 text-sm mt-1">Complete sales to see top products</p>
                    </div>
                `;
            }
        });

    } catch (error) {
        console.error("Error loading sales data:", error);
        const errorTableBody = document.getElementById('sales-table-body');
        if (errorTableBody) {
            errorTableBody.innerHTML = '<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">Failed to load sales data. Please try again.</td></tr>';
        }
        const chartLoading = document.getElementById('chart-loading');
        const chartEmpty = document.getElementById('chart-empty');
        const salesChartCanvas = document.getElementById('sales-chart');
        if (chartLoading) chartLoading.classList.add('hidden');
        if (chartEmpty) chartEmpty.classList.remove('hidden');
        if (salesChartCanvas) salesChartCanvas.classList.add('hidden');
        const topProductsContainer = document.getElementById('top-products-container');
        if (topProductsContainer) {
            topProductsContainer.innerHTML = `
                <div class="p-6 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                    <p class="text-gray-500">No products sold yet</p>
                    <p class="text-gray-400 text-sm mt-1">Complete sales to see top products</p>
                </div>
            `;
        }
    }
}

// One-time load as a fallback when RT listener is unavailable
async function loadSalesDataOnce(fromDate, toDate) {
    try {
        const range = { from: fromDate, to: toDate };
        if (!range.from || !range.to) {
            const r = getDateRange();
            range.from = r.from; range.to = r.to;
        }
        const salesQueryRef = query(
            collection(db, "sales"),
            where("timestamp", ">=", range.from),
            where("timestamp", "<=", range.to),
            orderBy("timestamp", "desc"),
            limit(50)
        );
        const snap = await getDocs(salesQueryRef);
        const salesData = [];
        snap.forEach(d => salesData.push({ id: d.id, ...d.data() }));
        latestSalesData = salesData;

        renderSalesTable(salesData);
        updateSalesSummary(salesData);
        setTimeout(() => updateSalesChart(salesData), 100);

        const chartLoading = document.getElementById('chart-loading');
        const chartEmpty = document.getElementById('chart-empty');
        const salesChartCanvas = document.getElementById('sales-chart');
        if (chartLoading) chartLoading.classList.add('hidden');
        if (salesData.length === 0) {
            if (chartEmpty) chartEmpty.classList.remove('hidden');
            if (salesChartCanvas) salesChartCanvas.classList.add('hidden');
        } else {
            if (chartEmpty) chartEmpty.classList.add('hidden');
            if (salesChartCanvas) salesChartCanvas.classList.remove('hidden');
        }
    } catch (e) {
        console.error('Fallback sales fetch failed:', e);
    }
}

// View receipt details strictly from DB/table data
async function viewReceiptDetails(receiptId, saleData = null) {
    if (typeof receiptViewNumber !== 'undefined' && receiptViewNumber) {
        receiptViewNumber.textContent = `Receipt #${receiptId}`;
    }

    let sale = saleData;
    if (!sale) {
        try {
            const snap = await getDoc(doc(db, 'sales', receiptId));
            if (snap.exists()) {
                sale = { id: snap.id, ...snap.data() };
            } else {
                throw new Error('Receipt not found');
            }
        } catch (e) {
            console.error('Failed to fetch receipt', e);
            receiptViewDetails.innerHTML = '<div class="text-center text-gray-600 py-6">Receipt not found.</div>';
            receiptViewModal.classList.remove('hidden');
            return;
        }
    }

    const paymentMethod = (sale.paymentMethod || 'cash').toLowerCase();

    const ts = sale.timestamp instanceof Date ? sale.timestamp : new Date(sale.timestamp?.seconds ? sale.timestamp.seconds * 1000 : sale.timestamp || Date.now());

    // Header (simplified): keep date/receipt/attendant only, match POS layout
    let receiptHTML = `
        <div class="text-center border-b border-gray-300 pb-3 mb-3">
            <p class="text-xs text-gray-500">${ts.toLocaleString()}</p>
            <p class="text-xs text-gray-500">Receipt #: ${sale.receiptNumber || sale.id}</p>
            <p class="text-xs text-gray-500">Attendant: ${sale.cashier || sale.attendant || 'N/A'}</p>
        </div>
        
        <div class="space-y-2 mb-3">
    `;

    (sale.items || []).forEach(item => {
        const qty = Number(item.quantity || 1);
        const price = Number(item.price || 0);
        receiptHTML += `
            <div class="flex justify-between text-sm">
                <div class="flex-1">
                    <div class="font-medium">${item.name}</div>
                    <div class="text-xs text-gray-500">${qty} x ₱${price}</div>
                </div>
                <div class="font-semibold">₱${(price * qty).toFixed(2)}</div>
            </div>
        `;
    });

    // Totals and payment info (match POS)
    receiptHTML += `
        </div>
        
        <div class="border-t border-gray-300 pt-3 space-y-1">
            <div class="flex justify-between font-semibold">
                <span>Total:</span>
                <span>₱${Number(sale.total || 0).toFixed(2)}</span>
            </div>
            <div class="flex justify-between text-sm font-medium">
                <span>Payment Method:</span>
                <span class="${paymentMethod === 'cash' ? 'text-green-700' : 'text-blue-700'}">${paymentMethod === 'cash' ? 'Cash' : 'GCash'}</span>
            </div>
    `;

    if (paymentMethod === 'cash') {
        const cashR = Number(sale.cashReceived || 0);
        const change = Number('change' in sale ? sale.change : cashR - Number(sale.total || 0));
        receiptHTML += `
            <div class="flex justify-between text-sm">
                <span>Cash Received:</span>
                <span>₱${cashR.toFixed(2)}</span>
            </div>
            <div class="flex justify-between font-semibold text-lg">
                <span>Change:</span>
                <span>₱${change.toFixed(2)}</span>
            </div>
        `;
    } else {
        receiptHTML += `
            <div class="flex justify-between text-sm">
                <span>GCash Ref #:</span>
                <span>${sale.referenceNumber || 'N/A'}</span>
            </div>
            <div class="flex justify-between font-semibold text-lg">
                <span>Amount Paid:</span>
                <span>₱${Number(sale.total || 0).toFixed(2)}</span>
            </div>
        `;
    }

    // Close totals section (no footer messages)
    receiptHTML += `</div>`;
    
    receiptViewDetails.innerHTML = receiptHTML;
    receiptViewModal.classList.remove('hidden');
}

// Print receipt
function printReceipt() {
    const printWindow = window.open('', '_blank');
    const receiptContent = receiptViewDetails.innerHTML;
    
    // Create the HTML content with proper escaping for JS template literals
    const htmlContent = '<!DOCTYPE html>' +
        '<html>' +
        '<head>' +
            '<title>Print Receipt</title>' +
            '<style>' +
                'body {' +
                    'font-family: "Courier New", monospace;' +
                    'font-size: 12px;' +
                    'width: 300px;' +
                    'margin: 0 auto;' +
                '}' +
                '.header {' +
                    'text-align: center;' +
                    'margin-bottom: 10px;' +
                '}' +
                '.header h1 {' +
                    'font-size: 18px;' +
                    'margin: 0;' +
                '}' +
                'table {' +
                    'width: 100%;' +
                    'border-collapse: collapse;' +
                '}' +
                'th, td {' +
                    'padding: 5px 0;' +
                '}' +
                'th {' +
                    'text-align: left;' +
                '}' +
                '.total {' +
                    'margin-top: 10px;' +
                    'border-top: 1px solid #000;' +
                    'padding-top: 10px;' +
                '}' +
                '.footer {' +
                    'margin-top: 20px;' +
                    'text-align: center;' +
                '}' +
            '</style>' +
        '</head>' +
        '<body>' +
            receiptContent +
        '</body>' +
        '</html>';
    
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    
    // Print and close window after a delay
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 500);
}

// Export sales data as CSV (DB-only)
function exportSalesData() {
    const { from: fromDateTime, to: toDateTime } = getDateRange();
    showNotification("Preparing sales data for export...");

    // Add Status column to CSV
    const csvHeader = ['Receipt #', 'Date', 'Items', 'Quantity', 'Price per Item', 'Subtotal', 'Payment Method', 'Status', 'Attendant', 'Total'];

    (async () => {
        try {
            const salesQueryRef = query(
                collection(db, "sales"),
                where("timestamp", ">=", fromDateTime),
                where("timestamp", "<=", toDateTime),
                orderBy("timestamp", "desc"),
                limit(1000)
            );
            const snap = await getDocs(salesQueryRef);
            const salesData = [];
            snap.forEach(d => salesData.push({ id: d.id, ...d.data() }));

            if (salesData.length === 0) {
                showNotification("No sales data in the selected range.");
                return;
            }

            const csvData = [csvHeader];
            salesData.forEach((sale) => {
                const ts = sale.timestamp instanceof Date ? sale.timestamp : new Date(sale.timestamp?.seconds ? sale.timestamp.seconds * 1000 : sale.timestamp || Date.now());
                // Local date YYYY-MM-DD (no time)
                const formattedDate = `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}`;
                const receiptId = sale.receiptNumber || sale.id || '';
                const statusText = statusLabel(getSaleStatus(sale));
                if (Array.isArray(sale.items) && sale.items.length > 0) {
                    sale.items.forEach((item, idx) => {
                        const subtotal = Number(item.price || 0) * Number(item.quantity || 1);
                        csvData.push([
                            idx === 0 ? receiptId : '',
                            idx === 0 ? formattedDate : '',
                            escapeCsvValue(item.name),
                            item.quantity || 1,
                            Number(item.price || 0).toFixed(2),
                            subtotal.toFixed(2),
                            idx === 0 ? (sale.paymentMethod || 'cash') + ' ' : '',
                            idx === 0 ? statusText : '',
                            idx === 0 ? escapeCsvValue(sale.cashier || sale.attendant || 'N/A') : '',
                            idx === 0 ? Number(sale.total || 0).toFixed(2) : ''
                        ]);
                    });
                } else {
                    csvData.push([
                        receiptId,
                        formattedDate,
                        'N/A',
                        1,
                        Number(sale.total || 0).toFixed(2),
                        Number(sale.total || 0).toFixed(2),
                        (sale.paymentMethod || 'cash') + ' ',
                        statusText,
                        escapeCsvValue(sale.cashier || sale.attendant || 'N/A'),
                        Number(sale.total || 0).toFixed(2)
                    ]);
                }
                csvData.push([]);
            });

            let csvContent = '';
            csvData.forEach(row => { csvContent += row.join(',') + '\r\n'; });

            const encodedUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
            const fromDateStr = formatLocalDate(fromDateTime);
            const toDateStr = formatLocalDate(toDateTime);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', `DaxSilog_Sales_${fromDateStr}_to_${toDateStr}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showNotification("CSV exported.", 'success');
        } catch (error) {
            console.error("Error exporting sales data:", error);
            showNotification("Failed to export sales data. Please try again.", 'error');
        }
    })();
}

// Helper function to escape CSV values
function escapeCsvValue(value) {
    if (value === undefined || value === null) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// Lightweight toast notification helper
function showNotification(message, type = 'info') {
    try {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.position = 'fixed';
            container.style.bottom = '20px';
            container.style.right = '20px';
            container.style.zIndex = '9999';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '8px';
            document.body.appendChild(container);
        }
        const bg = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-gray-800';
        const toast = document.createElement('div');
        toast.className = `${bg} text-white px-4 py-2 rounded-lg shadow-lg text-sm transition-opacity duration-300`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; }, 2200);
        setTimeout(() => { toast.remove(); }, 2600);
    } catch (_) {
        // Fallback to alert if DOM is not ready
        try { alert(message); } catch (_) {}
    }
}

// Status label helper
function statusLabel(raw) {
    const s = (raw || '').toLowerCase();
    if (s === 'canceled') return 'Cancelled';
    return s === 'cooking' ? 'Preparing' :
           s === 'waiting' ? 'Waiting' :
           s === 'ready' ? 'Ready' :
           s === 'served' ? 'Served' :
           s === 'cancelled' ? 'Cancelled' : '';
}
