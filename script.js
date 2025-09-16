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
// Control when inputs should auto-focus to avoid mobile scroll on load
let allowAutoFocus = false;

// Initialize flags and pending data
window._orderCancelled = false;
window._pendingSaleData = null;

// Custom Modal System
class CustomModal {
    constructor() {
        this.modal = document.getElementById('custom-alert-modal');
        this.title = document.getElementById('alert-title');
        this.message = document.getElementById('alert-message');
        this.icon = document.getElementById('alert-icon');
        this.buttons = document.getElementById('alert-buttons');
    }

    show(options) {
        return new Promise((resolve) => {
            const {
                title = 'Alert',
                message = '',
                type = 'info', // 'info', 'success', 'warning', 'error', 'confirm'
                confirmText = 'OK',
                cancelText = 'Cancel',
                showCancel = false
            } = options;

            // Set title and message
            this.title.textContent = title;
            this.message.textContent = message;

            // Set icon based on type
            this.setIcon(type);

            // Clear and set buttons
            this.buttons.innerHTML = '';

            if (showCancel) {
                const cancelBtn = document.createElement('button');
                cancelBtn.textContent = cancelText;
                cancelBtn.className = 'px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors duration-200 text-sm';
                cancelBtn.onclick = () => {
                    this.hide();
                    resolve(false);
                };
                this.buttons.appendChild(cancelBtn);
            }

            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = confirmText;
            confirmBtn.className = this.getButtonClass(type);
            confirmBtn.onclick = () => {
                this.hide();
                resolve(true);
            };
            this.buttons.appendChild(confirmBtn);

            // Show modal
            this.modal.classList.remove('hidden');
            
            // Focus the confirm button
            setTimeout(() => confirmBtn.focus(), 100);

            // Handle escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', handleEscape);
                    this.hide();
                    resolve(false);
                }
            };
            document.addEventListener('keydown', handleEscape);
        });
    }

    hide() {
        this.modal.classList.add('hidden');
    }

    setIcon(type) {
        this.icon.innerHTML = '';
        this.icon.className = 'w-8 h-8 rounded-full flex items-center justify-center mr-3';

        let iconHTML = '';
        let bgClass = '';

        switch (type) {
            case 'success':
                bgClass = 'bg-green-100';
                iconHTML = '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
                break;
            case 'error':
                bgClass = 'bg-red-100';
                iconHTML = '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
                break;
            case 'warning':
                bgClass = 'bg-yellow-100';
                iconHTML = '<svg class="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>';
                break;
            case 'confirm':
                bgClass = 'bg-blue-100';
                iconHTML = '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
                break;
            default: // info
                bgClass = 'bg-blue-100';
                iconHTML = '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        }

        this.icon.className += ' ' + bgClass;
        this.icon.innerHTML = iconHTML;
    }

    getButtonClass(type) {
        const baseClass = 'px-3 py-2 rounded-lg font-medium transition-colors duration-200 text-sm';
        switch (type) {
            case 'success':
                return `${baseClass} bg-green-600 hover:bg-green-700 text-white`;
            case 'error':
                return `${baseClass} bg-red-600 hover:bg-red-700 text-white`;
            case 'warning':
                return `${baseClass} bg-yellow-600 hover:bg-yellow-700 text-white`;
            case 'confirm':
                return `${baseClass} bg-blue-600 hover:bg-blue-700 text-white`;
            default:
                return `${baseClass} bg-gray-600 hover:bg-gray-700 text-white`;
        }
    }
}

// Create global modal instance
const customModal = new CustomModal();

// Custom alert and confirm functions
window.customAlert = async function(message, title = 'Alert', type = 'info') {
    return await customModal.show({
        title,
        message,
        type,
        confirmText: 'OK'
    });
};

window.customConfirm = async function(message, title = 'Confirm', type = 'confirm') {
    return await customModal.show({
        title,
        message,
        type,
        confirmText: 'Yes',
        cancelText: 'No',
        showCancel: true
    });
};

// Function to get appropriate image for menu items
function getImageForItem(itemName, type) {
    if (type === 'addon') {
        // For add-ons, default to the addon image, but allow custom override
        return 'media/addons.png';
    }
    
    // Normalize the item name for comparison (lowercase, remove spaces)
    const normalizedName = itemName.toLowerCase().replace(/\s+/g, '');
    
    // Map of item names to their image files
    const imageMap = {
        '1.5l': 'media/menu/1.5L.jpg',
        '1.5lwater': 'media/menu/1.5L.jpg',
        'water1.5l': 'media/menu/1.5L.jpg',
        'bangsilog': 'media/menu/bangsilog.png',
        'chixsilog': 'media/menu/chixsilog.png',
        'coffee': 'media/menu/coffee.jpg',
        'cornsilog': 'media/menu/cornsilog.png',
        'drinks': 'media/menu/drinks.png',
        'egg': 'media/menu/egg.png',
        'friededg': 'media/menu/egg.png',
        'friedrice': 'media/menu/friedrice.png',
        'yangchow': 'media/menu/friedrice.png',
        'halohalo': 'media/menu/halohalo.jpg',
        'halo-halo': 'media/menu/halohalo.jpg',
        'hotsilog': 'media/menu/hotsilog.png',
        'hungsilog': 'media/menu/hungsilog.png',
        'kasalo': 'media/menu/kasalo.jpg',
        'liemposilog': 'media/menu/liemposilog.png',
        'longsilog': 'media/menu/longsilog.png',
        'minutemaid': 'media/menu/minutemaid.jpg',
        'porksilog': 'media/menu/porksilog.png',
        'rice': 'media/menu/rice.jpg',
        'extrarice': 'media/menu/rice.jpg',
        'plainrice': 'media/menu/rice.jpg',
        'shangsilog': 'media/menu/shangsilog.png',
        'shiosilog': 'media/menu/shiosilog.png',
        'sisigrice': 'media/menu/sisigrice.png',
        'spamsilog': 'media/menu/spamsilog.png',
        'tapsilog': 'media/menu/tapsilog.png',
        'tocilog': 'media/menu/tocilog.png',
        'tosilog': 'media/menu/tocilog.png', // Map tosilog to tocilog image
        'sisig': 'media/menu/sisigrice.png', // Map sisig to sisigrice image
        'water': 'media/menu/water.jpg'
    };
    
    // Check for exact match first
    if (imageMap[normalizedName]) {
        return imageMap[normalizedName];
    }
    
    // Check for partial matches (if item name contains any of the mapped names)
    for (const [key, imagePath] of Object.entries(imageMap)) {
        if (normalizedName.includes(key) || key.includes(normalizedName)) {
            return imagePath;
        }
    }
    
    // Default fallback image for menu items
    return 'media/menu/tapsilog.png';
}

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
const editItemsContainer = document.getElementById('edit-items-container');

// Global unsubscribe function for cleanup
let unsubscribeFromFirestore = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    unsubscribeFromFirestore = subscribeItems();
    updateOrderDisplay();
    setupEventListeners();
    loadDailySales(); // Load daily sales from Firebase
    // Attempt to sync any pending sales saved locally (e.g., from offline)
    flushPendingSales();
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

    // Try to flush any pending sales when back online
    flushPendingSales();
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
                // Skip deleted items (but include items that are just inactive)
                if (d.isActive === false && d.deletedAt) return;
                
                const type = d.type === 'addon' ? 'addon' : 'menu';
                const item = {
                    id: typeof d.id === 'number' ? d.id : (Number(d.id) || Date.now()),
                    name: d.name,
                    price: Number(d.price) || 0,
                    image: d.customImage || getImageForItem(d.name, type), // Use custom image if available, otherwise auto-detect
                    type,
                    isActive: d.isActive !== false // Default to true if not specified
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
                    { id: 1, name: 'Tapsilog', price: 95, image: 'media/menu/tapsilog.png', type: 'menu' },
                    { id: 2, name: 'Tosilog', price: 85, image: 'media/menu/tocilog.png', type: 'menu' },
                    { id: 3, name: 'Sisig', price: 120, image: 'media/menu/sisigrice.png', type: 'menu' },
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
    closeReceiptBtn.addEventListener('click', handleCloseReceipt);
    cashReceivedInput.addEventListener('input', calculateChange);
    
    // Add event listeners for receipt buttons
    const saveReceiptBtn = document.getElementById('save-receipt-btn');
    const printReceiptBtn = document.getElementById('print-receipt-btn');
    const cancelOrderBtn = document.getElementById('cancel-order-btn');
    const editOrderBtn = document.getElementById('edit-order-btn');
    
    if (saveReceiptBtn) saveReceiptBtn.addEventListener('click', saveReceiptAsImage);
    if (printReceiptBtn) printReceiptBtn.addEventListener('click', printReceipt);
    if (cancelOrderBtn) cancelOrderBtn.addEventListener('click', cancelOrder);
    if (editOrderBtn) editOrderBtn.addEventListener('click', editOrder);
    
    // Add event listener for GCash reference input
    if (gcashReferenceInput) {
        gcashReferenceInput.addEventListener('input', updatePaymentButtonState);
    }

    // Payment method selection (enable auto-focus only after explicit user tap/click)
    cashMethodBtn.addEventListener('click', () => { allowAutoFocus = true; selectPaymentMethod('cash'); });
    gcashMethodBtn.addEventListener('click', () => { allowAutoFocus = true; selectPaymentMethod('gcash'); });
    
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
        await customAlert('Please enter a name', 'Validation Error', 'warning');
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
        await customAlert('Failed to add item', 'Error', 'error');
    }
}

// Render menu items
function renderMenuItems() {
    menuContainer.innerHTML = '';
    menuItems.forEach(item => {
        // Only show active/available items in the main menu
        if (item.isActive !== false) {
            const itemCard = createItemCard(item, 'menu');
            menuContainer.appendChild(itemCard);
        }
    });
}

// Render add-ons
function renderAddOns() {
    addonsContainer.innerHTML = '';
    addOns.forEach(item => {
        // Only show active/available items in the main menu
        if (item.isActive !== false) {
            const itemCard = createItemCard(item, 'addon');
            addonsContainer.appendChild(itemCard);
        }
    });
}

// Create item card
function createItemCard(item, type) {
    const card = document.createElement('div');
    card.className = 'item-card glass-container rounded-2xl p-4 cursor-pointer h-full flex flex-col';
    card.addEventListener('click', () => addToOrder(item.id, type));
    
    card.innerHTML = `
            <div class="item-thumb w-full h-24 bg-gray-100 rounded-lg mb-3 overflow-hidden">
                <img src="${item.image}" alt="${item.name}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
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
    
    // Only auto-focus after explicit user action (prevents mobile auto-scroll on load)
    if (allowAutoFocus) {
        if (isCashMethod && cashReceivedInput) {
            setTimeout(() => cashReceivedInput.focus(), 100);
            allowAutoFocus = false;
        } else if (isGcashMethod && gcashReferenceInput) {
            setTimeout(() => gcashReferenceInput.focus(), 100);
            allowAutoFocus = false;
        }
    }
}

// Helper: persist a failed sale to local storage for later retry
function queueLocalSale(saleDoc) {
    try {
        const key = 'pendingSales';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.push({ ...saleDoc, __queuedAt: new Date().toISOString() });
        localStorage.setItem(key, JSON.stringify(arr));
    } catch (_) { /* no-op */ }
}

// Helper: try to send any locally queued sales to Firestore
async function flushPendingSales() {
    const key = 'pendingSales';
    let arr;
    try {
        arr = JSON.parse(localStorage.getItem(key) || '[]');
    } catch (_) {
        arr = [];
    }
    if (!arr || !arr.length) return;
    if (!navigator.onLine) return;

    const remaining = [];
    for (const sale of arr) {
        try {
            // Remove client-only marker
            const { __queuedAt, ...docData } = sale;
            // Ensure a server timestamp so Sales date filters pick it up
            if (!docData.timestamp) {
                docData.timestamp = serverTimestamp();
            }
            await addDoc(collection(db, 'sales'), docData);
        } catch (e) {
            console.error('Failed to flush a pending sale, will retry later', e);
            remaining.push(sale);
        }
    }
    try {
        if (remaining.length) localStorage.setItem(key, JSON.stringify(remaining));
        else localStorage.removeItem(key);
    } catch (_) { /* no-op */ }
}

// Clear order (reset cart and payment inputs)
function clearOrder() {
    currentOrder = [];
    if (cashReceivedInput) cashReceivedInput.value = '';
    if (gcashReferenceInput) gcashReferenceInput.value = '';
    updateOrderDisplay();
}

// Process payment
async function processPayment() {
    // Get the current payment method
    const isCashMethod = cashMethodBtn.classList.contains('active');
    const isGcashMethod = gcashMethodBtn.classList.contains('active');
    
    if (currentOrder.length === 0) {
        await customAlert('Your order is empty.', 'No Items', 'warning');
        return;
    }
    
    if (isCashMethod) {
        const cashReceived = parseFloat(cashReceivedInput.value) || 0;
        if (cashReceived < totalAmount) {
            await customAlert('Insufficient cash amount.', 'Payment Error', 'warning');
            return;
        }
    } else if (isGcashMethod) {
        const gcashRef = gcashReferenceInput.value.trim();
        if (gcashRef.length < 5) {
            await customAlert('Please enter a valid GCash reference number.', 'Payment Error', 'warning');
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

    // Read the generated receipt number from the DOM (set by generateReceipt)
    const receiptDetailsEl = document.getElementById('receipt-details');
    const receiptNumber = receiptDetailsEl?.dataset?.receiptNumber || ('R' + Date.now().toString().slice(-6));

    // Update daily sales (UI)
    dailySales += totalAmount;
    const salesDisplayEl = document.getElementById('today-sales-display');
    if (salesDisplayEl) {
        salesDisplayEl.textContent = `₱${dailySales.toFixed(2)}`;
    }

    // Store sale data globally for later processing (when receipt is closed)
    window._pendingSaleData = {
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
        cashier: getCurrentUserName() || 'Unknown',
        storeLocation: 'Main Branch',
        receiptNumber: receiptNumber,
        ...(paymentMethod === 'cash' 
            ? { cashReceived: paymentDetails.cashReceived || 0, change: (paymentDetails.cashReceived || 0) - totalAmount }
            : { referenceNumber: paymentDetails.referenceNumber || '' })
    };
    
    clearOrder();
    receiptModal.classList.remove('hidden');
}

// Generate receipt
function generateReceipt(paymentMethod = 'cash', paymentDetails = {}) {
    const receiptDetails = document.getElementById('receipt-details');
    const now = new Date();
    const receiptNumber = 'R' + Date.now().toString().slice(-6);
    const attendantName = getCurrentUserName();
    
    // Reset cancelled state for new receipt
    window._orderCancelled = false;
    
    // Reset button states
    const cancelBtn = document.getElementById('cancel-order-btn');
    const editBtn = document.getElementById('edit-order-btn');
    if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancel Order';
        cancelBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    if (editBtn) {
        editBtn.disabled = false;
        editBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    
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
    
    // Header: remove big title/tagline, keep date, receipt #, attendant
    let receiptHTML = `
        <div class="text-center border-b border-gray-300 pb-3 mb-3">
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
    
    // Totals and payment info
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
    
    // Close totals section (no footer messages)
    receiptHTML += `
        </div>
    `;
    receiptDetails.innerHTML = receiptHTML;
}

// Save receipt as image manually (when user clicks Save button)
async function saveReceiptAsImage() {
    return new Promise(async (resolve, reject) => {
        const receiptContent = document.getElementById('receipt-content');
        const receiptElement = document.getElementById('receipt-details');
        if (!receiptContent || !receiptElement) {
            await customAlert('Receipt content not found', 'Error', 'error');
            return resolve();
        }

        const isoDate = receiptElement.dataset.date || new Date().toISOString();
        const dateStr = isoDate.slice(0, 10).replace(/-/g, ''); // YYYYMMDD
        const receiptNumber = receiptElement.dataset.receiptNumber || ('R' + Date.now().toString().slice(-6));
        const attendant = receiptElement.dataset.attendant || getCurrentUserName();
        const safeAttendantName = attendant.replace(/[^a-zA-Z0-9]/g, '');
        const fileName = `${dateStr}_${receiptNumber}_${safeAttendantName}.png`;

        html2canvas(receiptContent, {
            backgroundColor: null,
            scale: 2,
            logging: false
        }).then(canvas => {
            canvas.toBlob(async (blob) => {
                try {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = fileName;
                    link.click();
                    URL.revokeObjectURL(link.href);
                    await customAlert('Receipt saved successfully!', 'Success', 'success');
                } catch (error) {
                    await customAlert('Failed to save receipt', 'Error', 'error');
                }
                resolve();
            });
        }).catch(async (err) => {
            console.error('Failed to save receipt image', err);
            await customAlert('Failed to save receipt', 'Error', 'error');
            resolve();
        });
    });
}

// Cancel the current order
async function cancelOrder() {
    const confirmed = await customConfirm('Are you sure you want to cancel this order? This action cannot be undone.', 'Cancel Order', 'warning');
    if (confirmed) {
        // Mark order as cancelled
        window._orderCancelled = true;
        
        // Update receipt to show cancelled status
        const receiptDetails = document.getElementById('receipt-details');
        if (receiptDetails) {
            // Add cancelled watermark/notice to receipt
            const cancelledNotice = document.createElement('div');
            cancelledNotice.className = 'text-center text-red-600 font-bold text-lg mb-3 p-2 bg-red-100 rounded border-2 border-red-300';
            cancelledNotice.textContent = '🚫 ORDER CANCELLED 🚫';
            receiptDetails.insertBefore(cancelledNotice, receiptDetails.firstChild);
        }
        
        // Disable Cancel and Edit buttons
        const cancelBtn = document.getElementById('cancel-order-btn');
        const editBtn = document.getElementById('edit-order-btn');
        if (cancelBtn) {
            cancelBtn.disabled = true;
            cancelBtn.textContent = 'Order Cancelled';
            cancelBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
        if (editBtn) {
            editBtn.disabled = true;
            editBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
        
        // Close the receipt modal automatically after cancellation
        closeReceiptModal();
    }
}

// Edit the current order - restore order items and close receipt
async function editOrder() {
    if (window._lastReceiptOrder && window._lastReceiptOrder.items) {
        // Restore the order items to currentOrder
        currentOrder = window._lastReceiptOrder.items.map(item => ({
            ...item,
            quantity: item.quantity
        }));
        
        // Update the order display
        updateOrderDisplay();
        
        // Close the receipt modal
        closeReceiptModal();
        
        // Reset flags
        window._orderCancelled = false;
        
        await customAlert('Order restored for editing. You can now add or remove items.', 'Order Restored', 'success');
    } else {
        await customAlert('Unable to restore order for editing.', 'Error', 'error');
    }
}
async function printReceipt() {
    const receiptContent = document.getElementById('receipt-content');
    if (!receiptContent) {
        await customAlert('Receipt content not found', 'Error', 'error');
        return;
    }

    // Create a new window for printing
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) {
        await customAlert('Please allow pop-ups to print the receipt', 'Print Error', 'warning');
        return;
    }

    // Get the receipt HTML content
    const receiptHTML = receiptContent.innerHTML;
    
    // Create the print document
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Receipt</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 20px;
                    background: white;
                }
                .bg-gray-50 {
                    background: #f9fafb;
                    border: 2px dashed #d1d5db;
                    border-radius: 12px;
                    padding: 16px;
                }
                .text-center { text-align: center; }
                .border-b { border-bottom: 1px solid #e5e7eb; }
                .border-t { border-top: 1px solid #e5e7eb; }
                .border-gray-300 { border-color: #d1d5db; }
                .pb-3 { padding-bottom: 12px; }
                .mb-3 { margin-bottom: 12px; }
                .pt-3 { padding-top: 12px; }
                .space-y-1 > * + * { margin-top: 4px; }
                .space-y-2 > * + * { margin-top: 8px; }
                .text-xs { font-size: 12px; }
                .text-sm { font-size: 14px; }
                .text-lg { font-size: 18px; }
                .text-gray-500 { color: #6b7280; }
                .text-green-700 { color: #15803d; }
                .text-blue-700 { color: #1d4ed8; }
                .font-medium { font-weight: 500; }
                .font-semibold { font-weight: 600; }
                .flex { display: flex; }
                .justify-between { justify-content: space-between; }
                .flex-1 { flex: 1; }
                @media print {
                    body { margin: 0; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            ${receiptHTML}
            <script>
                window.onload = function() {
                    window.print();
                    window.close();
                };
            </script>
        </body>
        </html>
    `);
    
    printWindow.document.close();
}

// Handle close: queue order only if not cancelled, then close modal
async function handleCloseReceipt() {
    try {
        // Only add to queue if order wasn't cancelled
        if (!window._orderCancelled) {
            await addCurrentReceiptToQueue();
            
            // Save sales data to Firestore only for non-cancelled orders
            if (window._pendingSaleData) {
                try {
                    await addDoc(collection(db, 'sales'), window._pendingSaleData);
                } catch (error) {
                    console.error('Error saving sales data:', error);
                    queueLocalSale({ ...window._pendingSaleData,
                        // Use a client timestamp copy for awareness (won't be used by server)
                        clientTimestamp: new Date().toISOString()
                    });
                    await customAlert('Network issue: sale saved locally and will sync when online.', 'Offline Mode', 'warning');
                }
            }
        } else {
            // Order was cancelled - adjust daily sales display
            if (window._pendingSaleData) {
                dailySales -= window._pendingSaleData.total;
                const salesDisplayEl = document.getElementById('today-sales-display');
                if (salesDisplayEl) {
                    salesDisplayEl.textContent = `₱${dailySales.toFixed(2)}`;
                }
            }
        }
    } catch (e) {
        console.error('Auto actions on close failed', e);
    } finally {
        // Reset flags and clear pending data for next order
        window._orderCancelled = false;
        window._pendingSaleData = null;
        closeReceiptModal();
    }
}

// Add the current receipt/order to the queue (orders collection)
async function addCurrentReceiptToQueue() {
    if (!window._lastReceiptOrder || !window._lastReceiptOrder.items || window._lastReceiptOrder.items.length === 0) {
        // No order snapshot to queue
        return;
    }
    try {
        const data = window._lastReceiptOrder;
        await addDoc(collection(db, 'orders'), {
            items: data.items,
            totalAmount: data.totalAmount,
            paymentMethod: data.paymentMethod,
            cashier: data.cashier || getCurrentUserName() || 'Guest',
            receiptNumber: data.receiptNumber || null,
            status: 'cooking',
            timestamp: serverTimestamp()
        });
    } catch (err) {
        console.error('Failed to queue order automatically', err);
    }
}

// Clean up when closing receipt modal
function closeReceiptModal() {
    receiptModal.classList.add('hidden');
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
    
    // Get available images for the dropdown
    const availableImages = type === 'addon' ? 
        [
            { value: 'media/addons.png', label: 'Default Add-on' },
            { value: 'media/menu/1.5L.jpg', label: '1.5L Water' },
            { value: 'media/menu/bangsilog.png', label: 'Bangsilog' },
            { value: 'media/menu/chixsilog.png', label: 'Chixsilog' },
            { value: 'media/menu/coffee.jpg', label: 'Coffee' },
            { value: 'media/menu/cornsilog.png', label: 'Cornsilog' },
            { value: 'media/menu/drinks.png', label: 'Drinks' },
            { value: 'media/menu/egg.png', label: 'Egg' },
            { value: 'media/menu/friedrice.png', label: 'Fried Rice' },
            { value: 'media/menu/halohalo.jpg', label: 'Halo-Halo' },
            { value: 'media/menu/hotsilog.png', label: 'Hotsilog' },
            { value: 'media/menu/hungsilog.png', label: 'Hungsilog' },
            { value: 'media/menu/kasalo.jpg', label: 'Kasalo' },
            { value: 'media/menu/liemposilog.png', label: 'Liemposilog' },
            { value: 'media/menu/longsilog.png', label: 'Longsilog' },
            { value: 'media/menu/minutemaid.jpg', label: 'Minute Maid' },
            { value: 'media/menu/porksilog.png', label: 'Porksilog' },
            { value: 'media/menu/rice.jpg', label: 'Rice' },
            { value: 'media/menu/shangsilog.png', label: 'Shangsilog' },
            { value: 'media/menu/shiosilog.png', label: 'Shiosilog' },
            { value: 'media/menu/sisigrice.png', label: 'Sisig Rice' },
            { value: 'media/menu/spamsilog.png', label: 'Spamsilog' },
            { value: 'media/menu/tapsilog.png', label: 'Tapsilog' },
            { value: 'media/menu/tocilog.png', label: 'Tocilog' },
            { value: 'media/menu/water.jpg', label: 'Water' }
        ] :
        [
            { value: 'media/menu/1.5L.jpg', label: '1.5L Water' },
            { value: 'media/menu/bangsilog.png', label: 'Bangsilog' },
            { value: 'media/menu/chixsilog.png', label: 'Chixsilog' },
            { value: 'media/menu/coffee.jpg', label: 'Coffee' },
            { value: 'media/menu/cornsilog.png', label: 'Cornsilog' },
            { value: 'media/menu/drinks.png', label: 'Drinks' },
            { value: 'media/menu/egg.png', label: 'Egg' },
            { value: 'media/menu/friedrice.png', label: 'Fried Rice' },
            { value: 'media/menu/halohalo.jpg', label: 'Halo-Halo' },
            { value: 'media/menu/hotsilog.png', label: 'Hotsilog' },
            { value: 'media/menu/hungsilog.png', label: 'Hungsilog' },
            { value: 'media/menu/kasalo.jpg', label: 'Kasalo' },
            { value: 'media/menu/liemposilog.png', label: 'Liemposilog' },
            { value: 'media/menu/longsilog.png', label: 'Longsilog' },
            { value: 'media/menu/minutemaid.jpg', label: 'Minute Maid' },
            { value: 'media/menu/porksilog.png', label: 'Porksilog' },
            { value: 'media/menu/rice.jpg', label: 'Rice' },
            { value: 'media/menu/shangsilog.png', label: 'Shangsilog' },
            { value: 'media/menu/shiosilog.png', label: 'Shiosilog' },
            { value: 'media/menu/sisigrice.png', label: 'Sisig Rice' },
            { value: 'media/menu/spamsilog.png', label: 'Spamsilog' },
            { value: 'media/menu/tapsilog.png', label: 'Tapsilog' },
            { value: 'media/menu/tocilog.png', label: 'Tocilog' },
            { value: 'media/menu/water.jpg', label: 'Water' }
        ];
    
    // Create options for the select dropdown
    const imageOptions = availableImages.map(img => 
        `<option value="${img.value}" ${item.image === img.value ? 'selected' : ''}>${img.label}</option>`
    ).join('');
    
    card.innerHTML = `
        <div class="space-y-3">
            <!-- Image preview and selector -->
            <div class="flex items-center space-x-3">
                <div class="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                    <img id="preview-${item.id}" src="${item.image}" alt="${item.name}" class="w-full h-full object-cover">
                </div>
                <div class="flex-1">
                    <label class="block text-xs text-gray-500 mb-1">Image:</label>
                    <select 
                        class="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                        onchange="updateItemImage(${item.id}, '${type}', this.value)"
                    >
                        ${imageOptions}
                    </select>
                </div>
            </div>
            
            <!-- Availability toggle -->
            <div class="flex items-center space-x-2">
                <input 
                    type="checkbox" 
                    id="available-${item.id}" 
                    ${item.isActive !== false ? 'checked' : ''} 
                    class="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                    onchange="updateItemAvailability(${item.id}, '${type}', this.checked)"
                >
                <label for="available-${item.id}" class="text-sm font-medium text-gray-700">Available</label>
            </div>
            
            <!-- Name input -->
            <input 
                type="text" 
                value="${item.name}" 
                class="w-full px-2 py-1 border border-gray-300 rounded text-sm font-semibold"
                onchange="updateItemName(${item.id}, '${type}', this.value)"
                placeholder="Item name"
            >
            
            <!-- Price and delete -->
            <div class="flex items-center space-x-2">
                <input 
                    type="number" 
                    value="${item.price}" 
                    class="flex-1 px-2 py-1 border border-gray-300 rounded text-sm font-semibold text-center"
                    onchange="updateItemPrice(${item.id}, '${type}', this.value)"
                    min="1"
                    step="0.01"
                    placeholder="Price"
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
        await customAlert('Failed to update price', 'Error', 'error');
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
        await customAlert('Failed to update name', 'Error', 'error');
    }
}

// Update item image (persist to Firestore and update local state)
async function updateItemImage(itemId, type, newImagePath) {
    const docId = idToDoc.get(itemId);
    if (!docId) return;
    
    try {
        // Update Firestore with the custom image path
        await updateDoc(doc(db, 'items', docId), { customImage: newImagePath });
        
        // Update local menu/addon arrays
        const items = type === 'menu' ? menuItems : addOns;
        const item = items.find(i => i.id === itemId);
        if (item) {
            item.image = newImagePath;
        }
        
        // Update current order if item exists (for immediate UI)
        const orderItem = currentOrder.find(orderItem => orderItem.id === itemId && orderItem.type === type);
        if (orderItem) {
            orderItem.image = newImagePath;
            updateOrderDisplay();
        }
        
        // Update the preview image in the edit modal
        const previewImg = document.getElementById(`preview-${itemId}`);
        if (previewImg) {
            previewImg.src = newImagePath;
        }
        
        // Refresh the main menu display
        renderMenuItems();
        renderAddOns();
        
    } catch (err) {
        console.error('Failed to update image', err);
        await customAlert('Failed to update image', 'Error', 'error');
    }
}

// Update item availability (persist to Firestore and update local state)
async function updateItemAvailability(itemId, type, isAvailable) {
    const docId = idToDoc.get(itemId);
    if (!docId) return;
    
    try {
        // Update Firestore with the availability status
        await updateDoc(doc(db, 'items', docId), { isActive: isAvailable });
        
        // Update local menu/addon arrays
        const items = type === 'menu' ? menuItems : addOns;
        const item = items.find(i => i.id === itemId);
        if (item) {
            item.isActive = isAvailable;
        }
        
        // Remove from current order if item becomes unavailable
        if (!isAvailable) {
            const orderIndex = currentOrder.findIndex(orderItem => orderItem.id === itemId && orderItem.type === type);
            if (orderIndex >= 0) {
                currentOrder.splice(orderIndex, 1);
                updateOrderDisplay();
            }
        }
        
        // Refresh the main menu display to show/hide items
        renderMenuItems();
        renderAddOns();
        
    } catch (err) {
        console.error('Failed to update availability', err);
        await customAlert('Failed to update availability', 'Error', 'error');
    }
}

// Delete item (persist to Firestore)
async function deleteItem(itemId, type) {
    const docId = idToDoc.get(itemId);
    if (!docId) return;
    
    const confirmed = await customConfirm('Are you sure you want to delete this item?', 'Delete Item', 'warning');
    if (!confirmed) {
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
        const msg = (err && err.code === 'permission-denied')
          ? 'Failed to delete item: permission denied. Please sign in and ensure Firestore rules allow updating isActive/deletedAt.'
          : (err && err.message) || 'Failed to delete item';
        await customAlert(msg, 'Delete Error', 'error');
    }
}

// Modal functions for Menu Settings
function openEditModal() {
    renderEditableItems();
    // Rebind add-item button (in case modal was not in DOM earlier)
    const addItemBtn = document.getElementById('add-item-btn');
    if (addItemBtn) addItemBtn.addEventListener('click', handleAddItem);
    editModal.classList.remove('hidden');
}

function closeEditModal() {
    editModal.classList.add('hidden');
    // Refresh main item lists when closing
    renderMenuItems();
    renderAddOns();
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
            handleCloseReceipt();
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
        handleCloseReceipt();
    }
});

// Expose functions used by inline HTML when using ES modules
window.addToOrder = addToOrder;
window.updateQuantity = updateQuantity;
window.calculateChange = calculateChange;
window.updateItemPrice = updateItemPrice;
window.updateItemName = updateItemName;
window.updateItemImage = updateItemImage;
window.updateItemAvailability = updateItemAvailability;
window.deleteItem = deleteItem;
