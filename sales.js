// sales.js - Sales Dashboard functionality for DaxSilog POS System

import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, query, where, orderBy, limit, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

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
    db.settings({
        cacheSizeBytes: 50000000, // 50 MB
        ignoreUndefinedProperties: true,
    });
} catch (error) {
    console.warn("Could not configure Firestore settings:", error);
}

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

    // Set default date range (last 7 days)
    const today = new Date();
    dateToInput.valueAsDate = today;
    
    const weekAgo = new Date();
    weekAgo.setDate(today.getDate() - 7);
    dateFromInput.valueAsDate = weekAgo;
    
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
    
    // Load sales data with a slight delay
    setTimeout(() => {
        loadSalesData();
    }, 200);

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

        if (user) {
            // User is signed in
            if (signinLink) signinLink.classList.add('hidden');
            if (logoutBtn) {
                logoutBtn.classList.remove('hidden');
                logoutBtn.addEventListener('click', () => {
                    auth.signOut().then(() => {
                        window.location.href = 'login.html';
                    });
                });
            }
        } else {
            // User is signed out
            if (signinLink) signinLink.classList.remove('hidden');
            if (logoutBtn) logoutBtn.classList.add('hidden');
        }
    });
}

// Set up event listeners
function setupEventListeners() {
    // Date filter
    applyDateFilterBtn.addEventListener('click', () => {
        loadSalesData();
        updateSalesChart();
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
    const fromDate = new Date(dateFromInput.value);
    const toDate = new Date(dateToInput.value);
    
    // Show loading indicator and hide other elements
    const chartLoading = document.getElementById('chart-loading');
    const chartEmpty = document.getElementById('chart-empty');
    const salesChartCanvas = document.getElementById('sales-chart');
    
    if (chartLoading) chartLoading.classList.remove('hidden');
    if (chartEmpty) chartEmpty.classList.add('hidden');
    if (salesChartCanvas) salesChartCanvas.classList.add('hidden');

    // Generate date labels
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
        return; // do not fabricate data
    }

    if (chartLoading) chartLoading.classList.add('hidden');
    if (chartEmpty) chartEmpty.classList.add('hidden');
    if (salesChartCanvas) salesChartCanvas.classList.remove('hidden');

    salesChart.data.labels = labels;
    salesChart.data.datasets[0].data = data;
    salesChart.update();
}

// Render sales table with data
function renderSalesTable(salesData) {
    const tableBody = document.getElementById('sales-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    if (salesData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-gray-500">No sales data found for the selected period.</td></tr>';
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
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-800">${sale.id}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formattedDate}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${itemsText}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${sale.cashier || sale.attendant || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${paymentMethodHtml}
            </td>
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

// Update sales summary with data
function updateSalesSummary(salesData) {
    const totalSales = salesData.reduce((sum, sale) => sum + (sale.total || 0), 0);
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

// Load sales data from Firebase
async function loadSalesData() {
    try {
        const fromDate = new Date(dateFromInput.value);
        const toDate = new Date(dateToInput.value);
        toDate.setHours(23, 59, 59, 999);

        // Reset table to loading state
        const tableSalesBody = document.getElementById('sales-table-body');
        if (tableSalesBody) {
            tableSalesBody.innerHTML = `
                <tr>
                    <td colspan="7" class="px-6 py-6 text-center text-gray-500">
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

        let salesData = [];
        const salesQuery = query(
            collection(db, "sales"),
            where("timestamp", ">=", fromDate),
            where("timestamp", "<=", toDate),
            orderBy("timestamp", "desc"),
            limit(50)
        );

        const salesSnapshot = await getDocs(salesQuery);
        salesSnapshot.forEach((d) => salesData.push({ id: d.id, ...d.data() }));

        // Render strictly from DB; if no data, show empties
        renderSalesTable(salesData);
        updateSalesSummary(salesData);
        setTimeout(() => updateSalesChart(salesData), 100);

    } catch (error) {
        console.error("Error loading sales data:", error);
        const errorTableBody = document.getElementById('sales-table-body');
        if (errorTableBody) {
            errorTableBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-gray-500">Failed to load sales data. Please try again.</td></tr>';
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

// View receipt details strictly from DB/table data
async function viewReceiptDetails(receiptId, saleData = null) {
    receiptViewNumber.textContent = `Receipt #${receiptId}`;

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
    const paymentMethodDisplay = document.getElementById('receipt-payment-method');
    if (paymentMethod === 'cash') {
        paymentMethodDisplay.innerHTML = '<span class="px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-medium">Cash</span>';
    } else {
        paymentMethodDisplay.innerHTML = '<span class="px-2 py-1 bg-green-50 text-green-700 rounded-md text-xs font-medium">GCash</span>';
    }

    const ts = sale.timestamp instanceof Date ? sale.timestamp : new Date(sale.timestamp?.seconds ? sale.timestamp.seconds * 1000 : sale.timestamp || Date.now());

    let receiptHTML = `
        <div class="mb-4 pb-3 border-b border-gray-200">
            <div class="text-center mb-3">
                <h3 class="text-lg font-bold">DaxSilog</h3>
            </div>
            <div class="text-xs">
                <div class="flex justify-between"><span>Receipt #:</span><span>${sale.id}</span></div>
                <div class="flex justify-between"><span>Date:</span><span>${ts.toLocaleString()}</span></div>
                <div class="flex justify-between"><span>Attendant:</span><span>${sale.cashier || sale.attendant || 'N/A'}</span></div>
            </div>
        </div>
        <div class="mb-4">
            <table class="w-full text-xs">
                <thead>
                    <tr class="border-b border-gray-200">
                        <th class="py-2 text-left">Item</th>
                        <th class="py-2 text-center">Qty</th>
                        <th class="py-2 text-right">Price</th>
                        <th class="py-2 text-right">Total</th>
                    </tr>
                </thead>
                <tbody>
    `;

    (sale.items || []).forEach(item => {
        const qty = item.quantity || 1;
        const price = Number(item.price || 0);
        receiptHTML += `
            <tr class="border-b border-gray-100">
                <td class="py-2">${item.name}</td>
                <td class="py-2 text-center">${qty}</td>
                <td class="py-2 text-right">₱${price.toFixed(2)}</td>
                <td class="py-2 text-right">₱${(price * qty).toFixed(2)}</td>
            </tr>
        `;
    });

    receiptHTML += `
                </tbody>
            </table>
        </div>
        <div class="text-xs">
            <div class="flex justify-between py-1"><span class="font-semibold">Total:</span><span class="font-semibold">₱${Number(sale.total || 0).toFixed(2)}</span></div>
            <div class="flex justify-between py-1"><span>Payment Method:</span><span>${paymentMethod === 'cash' ? 'Cash' : 'GCash'}</span></div>
    `;

    if (paymentMethod === 'cash') {
        const cashR = Number(sale.cashReceived || 0);
        const change = Number(sale.change || (cashR - Number(sale.total || 0)) || 0);
        receiptHTML += `
            <div class="flex justify-between py-1"><span>Cash Received:</span><span>₱${cashR.toFixed(2)}</span></div>
            <div class="flex justify-between py-1"><span>Change:</span><span>₱${change.toFixed(2)}</span></div>
        `;
    } else {
        receiptHTML += `
            <div class="flex justify-between py-1"><span>Reference #:</span><span>${sale.referenceNumber || 'N/A'}</span></div>
        `;
    }

    receiptHTML += `</div>
        <div class="text-center mt-4 pt-4 border-t border-gray-200">
            <p class="text-xs font-semibold">Thank You for Your Purchase!</p>
            <p class="text-xs text-gray-500">Please Come Again</p>
        </div>`;
    
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
    const fromDate = dateFromInput.value;
    const toDate = dateToInput.value;
    showNotification("Preparing sales data for export...");

    const fromDateTime = new Date(fromDate);
    const toDateTime = new Date(toDate);
    toDateTime.setHours(23, 59, 59, 999);

    // Use date only in CSV
    const csvHeader = ['Receipt #', 'Date', 'Items', 'Quantity', 'Price per Item', 'Subtotal', 'Payment Method', 'Attendant', 'Total'];

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
                const receiptId = sale.id || '';
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
                        escapeCsvValue(sale.cashier || sale.attendant || 'N/A'),
                        Number(sale.total || 0).toFixed(2)
                    ]);
                }
                csvData.push([]);
            });

            let csvContent = '';
            csvData.forEach(row => { csvContent += row.join(',') + '\r\n'; });

            const encodedUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', `DaxSilog_Sales_${fromDate}_to_${toDate}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showNotification("CSV exported.");
        } catch (error) {
            console.error("Error exporting sales data:", error);
            showNotification("Failed to export sales data. Please try again.");
        }
    })();
}

// Helper function to escape CSV values
function escapeCsvValue(value) {
    if (value === null || value === undefined) return '';
    
    // Convert to string and handle special characters
    const stringValue = String(value);
    
    // If the value contains commas, quotes, or newlines, wrap it in quotes and escape any quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return '"' + stringValue.replace(/"/g, '""') + '"';
    }
    
    return stringValue;
}

// Helper function to show notifications
function showNotification(message) {
    // Check if notification container exists, if not create it
    let notifContainer = document.getElementById('notification-container');
    
    if (!notifContainer) {
        notifContainer = document.createElement('div');
        notifContainer.id = 'notification-container';
        notifContainer.className = 'fixed bottom-6 right-6 z-50 flex flex-col-reverse space-y-reverse space-y-2';
        document.body.appendChild(notifContainer);
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'bg-gray-800 text-white py-2 px-4 rounded-lg shadow-lg transform transition-all duration-500 opacity-0 translate-y-2';
    notification.textContent = message;
    
    // Add to container
    notifContainer.appendChild(notification);
    
    // Trigger animation
    setTimeout(() => {
        notification.classList.remove('opacity-0', 'translate-y-2');
    }, 10);
    
    // Remove after delay
    setTimeout(() => {
        notification.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => {
            if (notifContainer.contains(notification)) {
                notifContainer.removeChild(notification);
            }
        }, 500);
    }, 3000);
}
