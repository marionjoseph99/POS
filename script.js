// Firebase (ESM via CDN)
import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore, collection, addDoc, doc, onSnapshot, updateDoc, query, orderBy, serverTimestamp, getDoc, setDoc, getDocs, where } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { auth, getCurrentUserName } from './auth.js';

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyA7xio2a_7-9ZZTqN7Uc3ZIzipZYnnYj6k",
    authDomain: "pos-system-fa07b.firebaseapp.com",
    projectId: "pos-system-fa07b",
    storageBucket: "pos-system-fa07b.firebasestorage.app",
    messagingSenderId: "88080946373",
    appId: "1:88080946373:web:07bb37c5d8b228de638cac"
};

// Initialize Firebase with logging disabled
// Prefer an existing app (default if available, otherwise the first named app e.g., created by auth.js)
const apps = getApps();
let app;
if (apps.length) {
    try {
        app = getApp(); // default app if it exists
    } catch (e) {
        app = apps[0]; // fall back to the first existing (named) app
    }
} else {
    app = initializeApp(firebaseConfig);
}
const db = getFirestore(app);

// Add connection settings for better offline handling
try {
    // Check if we can access the Firestore SDK version being used
    const firestoreSettings = {
        // Cache results for offline use where possible
        cacheSizeBytes: 50000000, // 50 MB cache size
        experimentalForceLongPolling: true // Use long polling instead of WebSockets for better connection stability
    };
    
    // Apply settings safely
    if (typeof db.settings === 'function') {
        db.settings(firestoreSettings);
    }
} catch (err) {
    console.warn('Could not configure Firestore settings:', err);
}

// Apply more thorough error suppression for Firebase logs
if (typeof window._firebaseLogsFiltered === 'undefined') {
    window._firebaseLogsFiltered = true;
    
    // Store original console methods
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;
    
    // Filter function for Firebase-related noise
    const shouldFilter = (args) => {
        if (!args || args.length === 0) return false;
        
        const firstArg = args[0];
        if (typeof firstArg !== 'string') return false;
        
        // Filter common Firebase noise patterns
        return firstArg.includes('heartbeat') || 
               firstArg.includes('transport') || 
               firstArg.includes('@firebase') ||
               (args.length > 1 && args[1] && args[1].name === 'FirebaseError');
    };
    
    // Override console methods
    console.error = function(...args) {
        if (!shouldFilter(args)) {
            originalConsoleError.apply(console, args);
        }
    };
    
    console.warn = function(...args) {
        if (!shouldFilter(args)) {
            originalConsoleWarn.apply(console, args);
        }
    };
    
    console.log = function(...args) {
        if (!shouldFilter(args)) {
            originalConsoleLog.apply(console, args);
        }
    };
}

// In-memory data (populated from Firestore)
let menuItems = [];
let addOns = [];
const idToDoc = new Map(); // numeric item.id -> Firestore doc id

// Global variables
let currentOrder = [];
let totalAmount = 0;
let dailySales = 0; // Will be populated from Firebase

// Hold last receipt/order snapshot for queueing from receipt modal
window._lastReceiptOrder = null;

// DOM elements
const menuContainer = document.getElementById('menu-items-container');
const addonsContainer = document.getElementById('addons-items-container');
const orderList = document.getElementById('order-list');
const orderCount = document.getElementById('order-count');
const totalAmountElement = document.getElementById('total-amount');
const cashReceivedInput = document.getElementById('cash-received');
const changeAmountElement = document.getElementById('change-amount');
const emptyCartMessage = document.getElementById('empty-cart-message');
const processPaymentBtn = document.getElementById('process-payment-btn');
const clearOrderBtn = document.getElementById('clear-order-btn');
const cashMethodBtn = document.getElementById('cash-method-btn');
const gcashMethodBtn = document.getElementById('gcash-method-btn');
const cashPaymentSection = document.getElementById('cash-payment-section');
const gcashPaymentSection = document.getElementById('gcash-payment-section');
const gcashReferenceInput = document.getElementById('gcash-reference');

// Modal elements
const editModal = document.getElementById('edit-modal');
const receiptModal = document.getElementById('receipt-modal');
const editPricesBtn = document.getElementById('edit-prices-btn');
const closeEditModalBtn = document.getElementById('close-edit-modal');
const closeReceiptBtn = document.getElementById('close-receipt-btn');
const saveReceiptBtn = document.getElementById('save-receipt-btn');
const editItemsContainer = document.getElementById('edit-items-container');
const addToQueueBtn = document.getElementById('add-to-queue-btn');

// Global unsubscribe function for cleanup
let unsubscribeFromFirestore = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    unsubscribeFromFirestore = subscribeItems();
    updateOrderDisplay();
    setupEventListeners();
    loadDailySales(); // Load daily sales from Firebase
});

// Clean up when page is unloaded
window.addEventListener('beforeunload', function() {
    if (unsubscribeFromFirestore) {
        unsubscribeFromFirestore();
    }
});

// Network status monitoring
window.addEventListener('online', function() {
    updateNetworkStatus(true);
    
    // Re-subscribe to Firestore when connection is restored
    if (unsubscribeFromFirestore) {
        unsubscribeFromFirestore();
    }
    unsubscribeFromFirestore = subscribeItems();
});

window.addEventListener('offline', function() {
    updateNetworkStatus(false);
});

function subscribeItems() {
    // Set up network status monitoring
    updateNetworkStatus();
    
    // Create a query to get items ordered by name
    const q = query(collection(db, 'items'), orderBy('name'));
    
    // Add error handling for Firestore operations
    const unsubscribe = onSnapshot(q, 
        (snap) => {
            menuItems = [];
            addOns = [];
            idToDoc.clear();

            // Hide offline indicator when connection is working
            updateNetworkStatus(true); // true = online
            
            snap.forEach((s) => {
                const d = s.data();
                if (!d || !d.name || typeof d.type !== 'string') return;
                // Skip deleted items
                if (d.isActive === false) return;
                
                const type = d.type === 'addon' ? 'addon' : 'menu';
                const defaultImage = type === 'addon' ? 'media/addons.png' : 'media/tapsilog.png';
                const item = {
                    id: typeof d.id === 'number' ? d.id : (Number(d.id) || Date.now()),
                    name: d.name,
                    price: Number(d.price) || 0,
                    image: defaultImage,
                    type
                };
                idToDoc.set(item.id, s.id);
                (item.type === 'menu' ? menuItems : addOns).push(item);
            });

            renderMenuItems();
            renderAddOns();
            if (!editModal.classList.contains('hidden')) renderEditableItems();
            updateOrderDisplay();
        },
        (error) => {
            console.error('Error fetching items from Firestore:', error);
            
            // Show offline indicator
            updateNetworkStatus(false); // false = offline
            
            // If connection fails, fallback to some default items
            if (menuItems.length === 0 && addOns.length === 0) {
                const defaultItems = [
                    { id: 1, name: 'Tapsilog', price: 95, image: 'media/tapsilog.png', type: 'menu' },
                    { id: 2, name: 'Tosilog', price: 85, image: 'media/tapsilog.png', type: 'menu' },
                    { id: 3, name: 'Sisig', price: 120, image: 'media/tapsilog.png', type: 'menu' },
                    { id: 4, name: 'Extra Rice', price: 15, image: 'media/addons.png', type: 'addon' },
                    { id: 5, name: 'Fried Egg', price: 10, image: 'media/addons.png', type: 'addon' }
                ];
                
                defaultItems.forEach(item => {
                    if (item.type === 'menu') {
                        menuItems.push(item);
                    } else {
                        addOns.push(item);
                    }
                });
                
                renderMenuItems();
                renderAddOns();
                updateOrderDisplay();
            }
        }
    );
    
    // Return unsubscribe function for cleanup
    return unsubscribe;
}

// Helper function to update the network status indicator
function updateNetworkStatus(isOnline) {
    const offlineIndicator = document.getElementById('offline-indicator');
    if (!offlineIndicator) return;
    
    if (isOnline === undefined) {
        // If not specified, determine based on navigator.onLine
        isOnline = navigator.onLine;
    }
    
    if (isOnline) {
        offlineIndicator.classList.add('hidden');
    } else {
        offlineIndicator.classList.remove('hidden');
    }
}

// Load daily sales from Firebase
async function loadDailySales() {
    try {
        // Get today's date at midnight
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Query sales collection for today's sales
        const salesQuery = query(
            collection(db, "sales"),
            where("timestamp", ">=", today)
        );
        
        // Get the results
        const querySnapshot = await getDocs(salesQuery);
        
        // Calculate the total
        let todaySales = 0;
        querySnapshot.forEach((doc) => {
            const sale = doc.data();
            if (sale.total) {
                todaySales += Number(sale.total);
            }
        });
        
        // Update the global variable
        dailySales = todaySales;
        
        // Update the display
        const salesDisplay = document.getElementById('today-sales-display');
        if (salesDisplay) {
            salesDisplay.textContent = `₱${dailySales.toFixed(2)}`;
        }
    } catch (error) {
        console.error("Error loading daily sales:", error);
    }
}

// Setup event listeners
function setupEventListeners() {
    processPaymentBtn.addEventListener('click', processPayment);
    clearOrderBtn.addEventListener('click', clearOrder);
    editPricesBtn.addEventListener('click', openEditModal);
    closeEditModalBtn.addEventListener('click', closeEditModal);
    closeReceiptBtn.addEventListener('click', closeReceiptModal);
    saveReceiptBtn.addEventListener('click', saveReceiptAsImage);
    cashReceivedInput.addEventListener('input', calculateChange);
    
    // Add event listener for GCash reference input
    if (gcashReferenceInput) {
        gcashReferenceInput.addEventListener('input', updatePaymentButtonState);
    }

    // Add to Queue from receipt
    if (addToQueueBtn) {
        addToQueueBtn.addEventListener('click', addCurrentReceiptToQueue);
    }

    // Payment method selection
    cashMethodBtn.addEventListener('click', () => selectPaymentMethod('cash'));
    gcashMethodBtn.addEventListener('click', () => selectPaymentMethod('gcash'));
    
    const addItemBtn = document.getElementById('add-item-btn');
    if (addItemBtn) addItemBtn.addEventListener('click', handleAddItem);
}

async function handleAddItem(e) {
    e.preventDefault();
    const nameEl = document.getElementById('new-item-name');
    const priceEl = document.getElementById('new-item-price');
    const typeEl = document.getElementById('new-item-type');

    const name = (nameEl?.value || '').trim();
    const price = Number(priceEl?.value || 0);
    const type = (typeEl?.value || 'menu').toLowerCase() === 'addon' ? 'addon' : 'menu';

    if (!name) {
        alert('Please enter a name');
        return;
    }

    const numericId = Date.now();
    try {
        await addDoc(collection(db, 'items'), {
            id: numericId,
            name,
            price: isNaN(price) ? 0 : price,
            // image is derived by type in UI, so no need to store
            type,
            isActive: true,
            createdAt: serverTimestamp()
        });
        if (nameEl) nameEl.value = '';
        if (priceEl) priceEl.value = '';
        if (typeEl) typeEl.value = 'menu';
    } catch (err) {
        console.error('Failed to add item', err);
        alert('Failed to add item');
    }
}

// Render menu items
function renderMenuItems() {
    menuContainer.innerHTML = '';
    menuItems.forEach(item => {
        const itemCard = createItemCard(item, 'menu');
        menuContainer.appendChild(itemCard);
    });
}

// Render add-ons
function renderAddOns() {
    addonsContainer.innerHTML = '';
    addOns.forEach(item => {
        const itemCard = createItemCard(item, 'addon');
        addonsContainer.appendChild(itemCard);
    });
}

// Create item card
function createItemCard(item, type) {
    const card = document.createElement('div');
    card.className = 'item-card glass-container rounded-2xl p-4 cursor-pointer h-full flex flex-col';
    card.addEventListener('click', () => addToOrder(item.id, type));
    const imageSrc = type === 'addon' ? 'media/addons.png' : 'media/tapsilog.png';
    card.innerHTML = `
            <div class="item-thumb w-full h-24 bg-gray-100 rounded-lg mb-3 overflow-hidden">
                <img src="${imageSrc}" alt="${item.name}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="w-full h-full bg-gradient-to-br from-gray-200 to-gray-300 rounded-lg flex items-center justify-center text-gray-500 text-sm font-medium hidden">
                    <span>No Image</span>
                </div>
            </div>
        
        <div class="flex-1 flex flex-col">
            <h3 class="item-title font-bold text-gray-800 text-sm line-clamp-1 mb-3">${item.name}</h3>
            <div class="mt-auto w-full">
                <span class="price-badge price-badge-green">₱${item.price}</span>
            </div>
        </div>
    `;
    return card;
}

// Add item to order
function addToOrder(itemId, type) {
    const items = type === 'menu' ? menuItems : addOns;
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const existingOrderItem = currentOrder.find(orderItem => orderItem.id === itemId && orderItem.type === type);
    if (existingOrderItem) {
        existingOrderItem.quantity += 1;
    } else {
        currentOrder.push({ ...item, type, quantity: 1 });
    }
    updateOrderDisplay();
}

// Update order display
function updateOrderDisplay() {
    if (currentOrder.length === 0) {
        orderList.innerHTML = '';
        emptyCartMessage.classList.remove('hidden');
        orderCount.textContent = '0';
        totalAmount = 0;
    } else {
        emptyCartMessage.classList.add('hidden');
        orderList.innerHTML = '';
        let itemCount = 0;
        totalAmount = 0;
        currentOrder.forEach(orderItem => {
            const row = document.createElement('tr');
            const itemTotal = orderItem.price * orderItem.quantity;
            itemCount += orderItem.quantity;
            totalAmount += itemTotal;
            row.innerHTML = `
                <td class="font-medium text-sm">
                    <div class="line-clamp-1">${orderItem.name}</div>
                    <div class="text-xs text-gray-500">${orderItem.type === 'menu' ? 'Main' : 'Add-on'}</div>
                </td>
                <td class="text-center">
                    <div class="flex items-center justify-center space-x-2">
                        <button class="qty-btn text-xs" onclick="updateQuantity(${orderItem.id}, '${orderItem.type}', -1)">-</button>
                        <span class="font-semibold min-w-[20px] text-center">${orderItem.quantity}</span>
                        <button class="qty-btn text-xs" onclick="updateQuantity(${orderItem.id}, '${orderItem.type}', 1)">+</button>
                    </div>
                </td>
                <td class="text-right font-semibold">₱${itemTotal}</td>
            `;
            orderList.appendChild(row);
        });
        orderCount.textContent = itemCount;
    }
    totalAmountElement.textContent = `₱${totalAmount.toFixed(2)}`;
    calculateChange();
}

// Update quantity
function updateQuantity(itemId, type, change) {
    const orderItem = currentOrder.find(item => item.id === itemId && item.type === type);
    if (!orderItem) return;
    orderItem.quantity += change;
    if (orderItem.quantity <= 0) {
        const index = currentOrder.findIndex(item => item.id === itemId && item.type === type);
        currentOrder.splice(index, 1);
    }
    updateOrderDisplay();
}

// Select payment method
function selectPaymentMethod(method) {
    // Update button states
    cashMethodBtn.classList.toggle('active', method === 'cash');
    gcashMethodBtn.classList.toggle('active', method === 'gcash');
    
    // Show relevant payment section
    cashPaymentSection.classList.toggle('hidden', method !== 'cash');
    gcashPaymentSection.classList.toggle('hidden', method !== 'gcash');
    
    // Update validation for payment button
    updatePaymentButtonState();
}

// Calculate change
function calculateChange() {
    const cashReceived = parseFloat(cashReceivedInput.value) || 0;
    const change = cashReceived - totalAmount;
    changeAmountElement.textContent = `₱${Math.max(0, change).toFixed(2)}`;
    updatePaymentButtonState();
}

// Update payment button state based on current payment method
function updatePaymentButtonState() {
    const isCashMethod = !cashMethodBtn.classList.contains('hidden') && cashMethodBtn.classList.contains('active');
    const isGcashMethod = !gcashMethodBtn.classList.contains('hidden') && gcashMethodBtn.classList.contains('active');
    
    let isPaymentValid = false;
    
    if (isCashMethod) {
        const cashReceived = parseFloat(cashReceivedInput.value) || 0;
        isPaymentValid = cashReceived >= totalAmount;
    } else if (isGcashMethod) {
        const gcashRef = gcashReferenceInput ? gcashReferenceInput.value.trim() : '';
        isPaymentValid = gcashRef.length >= 5; // Require at least 5 characters for reference
    }
    
    const hasItems = currentOrder.length > 0;
    processPaymentBtn.disabled = !isPaymentValid || !hasItems;
    
    if (processPaymentBtn.disabled) {
        processPaymentBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        processPaymentBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    
    // Update input field focus when switching payment methods
    if (isCashMethod && cashReceivedInput) {
        setTimeout(() => cashReceivedInput.focus(), 100);
    } else if (isGcashMethod && gcashReferenceInput) {
        setTimeout(() => gcashReferenceInput.focus(), 100);
    }
}

// Process payment
function processPayment() {
    // Get the current payment method
    const isCashMethod = cashMethodBtn.classList.contains('active');
    const isGcashMethod = gcashMethodBtn.classList.contains('active');
    
    if (currentOrder.length === 0) {
        alert('Your order is empty.');
        return;
    }
    
    if (isCashMethod) {
        const cashReceived = parseFloat(cashReceivedInput.value) || 0;
        if (cashReceived < totalAmount) {
            alert('Insufficient cash amount.');
            return;
        }
    } else if (isGcashMethod) {
        const gcashRef = gcashReferenceInput.value.trim();
        if (gcashRef.length < 5) {
            alert('Please enter a valid GCash reference number.');
            return;
        }
    }
    
    // Store payment method and details for receipt
    const paymentMethod = isCashMethod ? 'cash' : 'gcash';
    const paymentDetails = isCashMethod ? 
        { cashReceived: parseFloat(cashReceivedInput.value) || 0 } : 
        { referenceNumber: gcashReferenceInput.value.trim() };
    
    // Generate receipt with payment method
    generateReceipt(paymentMethod, paymentDetails);
    
    // Update daily sales
    dailySales += totalAmount;
    const salesDisplayEl = document.getElementById('today-sales-display');
    if (salesDisplayEl) {
        salesDisplayEl.textContent = `₱${dailySales.toFixed(2)}`;
    }
    
    try {
        // Store transaction in Firestore
        addDoc(collection(db, "sales"), {
            items: currentOrder.map(item => ({
                id: item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                type: item.type
            })),
            total: totalAmount,
            timestamp: serverTimestamp(),
            paymentMethod: paymentMethod,
            cashier: getCurrentUserName() || "Unknown",
            storeLocation: "Main Branch"
        }).catch(error => {
            console.error("Error saving sales data:", error);
            // Continue with receipt display even if save fails
        });
    } catch (error) {
        console.error("Error in sales data save:", error);
    }
    
    clearOrder();
    receiptModal.classList.remove('hidden');
}

// Generate receipt
function generateReceipt(paymentMethod = 'cash', paymentDetails = {}) {
    const receiptDetails = document.getElementById('receipt-details');
    const now = new Date();
    const receiptNumber = 'R' + Date.now().toString().slice(-6);
    const attendantName = getCurrentUserName();
    
    // Capture a snapshot of the order for queueing later
    window._lastReceiptOrder = {
        items: currentOrder.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity, type: i.type })),
        totalAmount: totalAmount,
        paymentMethod,
        paymentDetails,
        cashier: attendantName,
        receiptNumber,
        createdAt: now.toISOString()
    };
    
    // Store receipt data as data attributes for easy access when saving
    receiptDetails.dataset.date = now.toISOString();
    receiptDetails.dataset.receiptNumber = receiptNumber;
    receiptDetails.dataset.attendant = attendantName;
    receiptDetails.dataset.paymentMethod = paymentMethod;
    
    let receiptHTML = `
        <div class="text-center border-b border-gray-300 pb-3 mb-3">
            <h3 class="font-bold text-lg">Silog Point of Sale</h3>
            <p class="text-sm text-gray-600">Restaurant Management System</p>
            <p class="text-xs text-gray-500">${now.toLocaleString()}</p>
            <p class="text-xs text-gray-500">Receipt #: ${receiptNumber}</p>
            <p class="text-xs text-gray-500">Attendant: ${attendantName}</p>
        </div>
        
        <div class="space-y-2 mb-3">
    `;
    currentOrder.forEach(item => {
        const itemTotal = item.price * item.quantity;
        receiptHTML += `
            <div class="flex justify-between text-sm">
                <div class="flex-1">
                    <div class="font-medium">${item.name}</div>
                    <div class="text-xs text-gray-500">${item.quantity} x ₱${item.price}</div>
                </div>
                <div class="font-semibold">₱${itemTotal.toFixed(2)}</div>
            </div>
        `;
    });
    
    // Add payment method specific details
    receiptHTML += `
        </div>
        
        <div class="border-t border-gray-300 pt-3 space-y-1">
            <div class="flex justify-between font-semibold">
                <span>Total:</span>
                <span>₱${totalAmount.toFixed(2)}</span>
            </div>
            <div class="flex justify-between text-sm font-medium">
                <span>Payment Method:</span>
                <span class="${paymentMethod === 'cash' ? 'text-green-700' : 'text-blue-700'}">${paymentMethod === 'cash' ? 'Cash' : 'GCash'}</span>
            </div>
    `;
    
    if (paymentMethod === 'cash') {
        const cashReceived = paymentDetails.cashReceived || 0;
        const change = cashReceived - totalAmount;
        receiptHTML += `
            <div class="flex justify-between text-sm">
                <span>Cash Received:</span>
                <span>₱${cashReceived.toFixed(2)}</span>
            </div>
            <div class="flex justify-between font-semibold text-lg">
                <span>Change:</span>
                <span>₱${change.toFixed(2)}</span>
            </div>
        `;
    } else if (paymentMethod === 'gcash') {
        receiptHTML += `
            <div class="flex justify-between text-sm">
                <span>GCash Ref #:</span>
                <span>${paymentDetails.referenceNumber || 'N/A'}</span>
            </div>
            <div class="flex justify-between font-semibold text-lg">
                <span>Amount Paid:</span>
                <span>₱${totalAmount.toFixed(2)}</span>
            </div>
        `;
    }
    
    receiptHTML += `
        </div>
        
        <div class="text-center mt-4 pt-3 border-t border-gray-300">
            <p class="text-xs text-gray-500">Thank you for your business!</p>
            <p class="text-xs text-gray-500">Please come again!</p>
            <p class="text-xs font-medium mt-2">Served by: ${attendantName}</p>
        </div>
    `;
    receiptDetails.innerHTML = receiptHTML;
}

// Add the current receipt/order to the queue (orders collection)
async function addCurrentReceiptToQueue() {
    if (!window._lastReceiptOrder || !window._lastReceiptOrder.items || window._lastReceiptOrder.items.length === 0) {
        alert('No order to queue.');
        return;
    }
    if (!addToQueueBtn) return;
    try {
        addToQueueBtn.disabled = true;
        addToQueueBtn.classList.add('opacity-60', 'cursor-not-allowed');
        const data = window._lastReceiptOrder;
        await addDoc(collection(db, 'orders'), {
            items: data.items,
            totalAmount: data.totalAmount,
            paymentMethod: data.paymentMethod,
            cashier: data.cashier || getCurrentUserName() || 'Guest',
            receiptNumber: data.receiptNumber || null,
            status: 'cooking', // Preparing
            timestamp: serverTimestamp()
        });
        // Navigate to the Orders page to view the queue
        window.location.href = 'orders.html';
    } catch (err) {
        console.error('Failed to queue order', err);
        alert('Failed to add to queue');
    } finally {
        addToQueueBtn.disabled = false;
        addToQueueBtn.classList.remove('opacity-60', 'cursor-not-allowed');
    }
}

// Clear order
function clearOrder() {
    currentOrder = [];
    cashReceivedInput.value = '';
    updateOrderDisplay();
}

// Modal functions
function openEditModal() {
    renderEditableItems();
    // Rebind add-item button (in case modal was not in DOM earlier)
    const addItemBtn = document.getElementById('add-item-btn');
    if (addItemBtn) addItemBtn.addEventListener('click', handleAddItem);
    editModal.classList.remove('hidden');
}

function closeEditModal() {
    editModal.classList.add('hidden');
    renderMenuItems();
    renderAddOns();
}

function closeReceiptModal() {
    receiptModal.classList.add('hidden');
}

// Save receipt as image
function saveReceiptAsImage() {
    // Hide the save button temporarily
    saveReceiptBtn.style.display = 'none';
    
    const receiptContent = document.getElementById('receipt-content');
    const receiptElement = document.getElementById('receipt-details');
    
    // Get data from data attributes
    const isoDate = receiptElement.dataset.date || new Date().toISOString();
    const dateStr = isoDate.slice(0, 10).replace(/-/g, ''); // YYYYMMDD format
    const receiptNumber = receiptElement.dataset.receiptNumber || ('R' + Date.now().toString().slice(-6));
    const attendant = receiptElement.dataset.attendant || getCurrentUserName();
    
    // Create a safe attendant name for the filename (remove spaces, special chars)
    const safeAttendantName = attendant.replace(/[^a-zA-Z0-9]/g, '');
    
    // Create the filename
    const fileName = `${dateStr}_${receiptNumber}_${safeAttendantName}.png`;
    
    // Use html2canvas to convert the receipt to an image
    html2canvas(receiptContent, {
        backgroundColor: null,
        scale: 2, // Higher resolution
        logging: false
    }).then(canvas => {
        // Convert canvas to blob
        canvas.toBlob(blob => {
            // Create a download link
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            
            // Trigger the download
            link.click();
            
            // Clean up
            URL.revokeObjectURL(link.href);
            
            // Show the save button again
            saveReceiptBtn.style.display = '';
        });
    }).catch(error => {
        console.error('Failed to save receipt as image:', error);
        alert('Failed to save receipt as image');
        saveReceiptBtn.style.display = '';
    });
}

// Render editable items in modal
function renderEditableItems() {
    editItemsContainer.innerHTML = '';
    menuItems.forEach(item => {
        const editCard = createEditableCard(item, 'menu');
        editItemsContainer.appendChild(editCard);
    });
    const separator = document.createElement('div');
    separator.className = 'col-span-full border-t border-gray-300 my-4';
    separator.innerHTML = '<h3 class="text-lg font-semibold text-gray-700 mt-4">Add-ons</h3>';
    editItemsContainer.appendChild(separator);
    addOns.forEach(item => {
        const editCard = createEditableCard(item, 'addon');
        editItemsContainer.appendChild(editCard);
    });
}

// Create editable card
function createEditableCard(item, type) {
    const card = document.createElement('div');
    card.className = 'glass-container rounded-xl p-4';
    card.innerHTML = `
        <div class="space-y-3">
            <input 
                type="text" 
                value="${item.name}" 
                class="w-full px-2 py-1 border border-gray-300 rounded text-sm font-semibold"
                onchange="updateItemName(${item.id}, '${type}', this.value)"
                placeholder="Item name"
            >
            <div class="flex items-center space-x-2">
                <span class="text-xs text-gray-500">₱</span>
                <input 
                    type="number" 
                    value="${item.price}" 
                    class="flex-1 px-2 py-1 border border-gray-300 rounded text-sm font-semibold text-center"
                    onchange="updateItemPrice(${item.id}, '${type}', this.value)"
                    min="1"
                    step="0.01"
                >
                <button class="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-medium border border-red-300"
                    onclick="deleteItem(${item.id}, '${type}')">
                    Delete
                </button>
            </div>
        </div>
    `;
    return card;
}

// Update item price (persist to Firestore)
async function updateItemPrice(itemId, type, newPrice) {
    const docId = idToDoc.get(itemId);
    if (!docId) return;
    const price = Number(newPrice) || 0;
    try {
        await updateDoc(doc(db, 'items', docId), { price });
        // Update current order if item exists (for immediate UI)
        const orderItem = currentOrder.find(orderItem => orderItem.id === itemId && orderItem.type === type);
        if (orderItem) {
            orderItem.price = price;
            updateOrderDisplay();
        }
    } catch (err) {
        console.error('Failed to update price', err);
        alert('Failed to update price');
    }
}

// Update item name (persist to Firestore)
async function updateItemName(itemId, type, newName) {
    const docId = idToDoc.get(itemId);
    if (!docId) return;
    const name = newName.trim();
    if (!name) return;
    
    try {
        await updateDoc(doc(db, 'items', docId), { name });
        // Update current order if item exists (for immediate UI)
        const orderItem = currentOrder.find(orderItem => orderItem.id === itemId && orderItem.type === type);
        if (orderItem) {
            orderItem.name = name;
            updateOrderDisplay();
        }
    } catch (err) {
        console.error('Failed to update name', err);
        alert('Failed to update name');
    }
}

// Delete item (persist to Firestore)
async function deleteItem(itemId, type) {
    const docId = idToDoc.get(itemId);
    if (!docId) return;
    
    if (!confirm(`Are you sure you want to delete this item?`)) {
        return;
    }
    
    try {
        // First approach: Mark as deleted rather than physically delete
        await updateDoc(doc(db, 'items', docId), { 
            isActive: false,
            deletedAt: serverTimestamp()
        });
        
        // Remove from current order if exists
        const orderIndex = currentOrder.findIndex(orderItem => orderItem.id === itemId && orderItem.type === type);
        if (orderIndex >= 0) {
            currentOrder.splice(orderIndex, 1);
            updateOrderDisplay();
        }
        
        // Refresh editable items display
        renderEditableItems();
    } catch (err) {
        console.error('Failed to delete item', err);
        alert('Failed to delete item');
    }
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // F1 - Focus on cash input
    if (e.key === 'F1') {
        e.preventDefault();
        if (!cashPaymentSection.classList.contains('hidden')) {
            cashReceivedInput.focus();
        } else if (!gcashPaymentSection.classList.contains('hidden')) {
            gcashReferenceInput.focus();
        }
    }
    // F2 - Process payment
    if (e.key === 'F2') {
        e.preventDefault();
        if (!processPaymentBtn.disabled) {
            processPayment();
        }
    }
    // F3 - Clear order
    if (e.key === 'F3') {
        e.preventDefault();
        clearOrder();
    }
    // F4 - Toggle payment method
    if (e.key === 'F4') {
        e.preventDefault();
        if (cashMethodBtn.classList.contains('active')) {
            selectPaymentMethod('gcash');
        } else {
            selectPaymentMethod('cash');
        }
    }
    // Escape - Close modals
    if (e.key === 'Escape') {
        if (!editModal.classList.contains('hidden')) {
            closeEditModal();
        }
        if (!receiptModal.classList.contains('hidden')) {
            closeReceiptModal();
        }
    }
});

// Click outside modal to close
editModal.addEventListener('click', function(e) {
    if (e.target === editModal) {
        closeEditModal();
    }
});

receiptModal.addEventListener('click', function(e) {
    if (e.target === receiptModal) {
        closeReceiptModal();
    }
});

// Expose functions used by inline HTML when using ES modules
window.addToOrder = addToOrder;
window.updateQuantity = updateQuantity;
window.calculateChange = calculateChange;
window.updateItemPrice = updateItemPrice;
window.updateItemName = updateItemName;
window.deleteItem = deleteItem;
