import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, updateProfile } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore, setDoc, doc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyA7xio2a_7-9ZZTqN7Uc3ZIzipZYnnYj6k",
  authDomain: "pos-system-fa07b.firebaseapp.com",
  projectId: "pos-system-fa07b",
  storageBucket: "pos-system-fa07b.firebasestorage.app",
  messagingSenderId: "88080946373",
  appId: "1:88080946373:web:07bb37c5d8b228de638cac"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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

// Tab switching
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const tabForgot = document.getElementById('tab-forgot');
const formLogin = document.getElementById('form-login');
const formRegister = document.getElementById('form-register');
const formForgot = document.getElementById('form-forgot');
const msg = document.getElementById('auth-message');

function setTab(which) {
  tabLogin.classList.toggle('bg-gray-100', which === 'login');
  tabRegister.classList.toggle('bg-gray-100', which === 'register');
  tabForgot.classList.toggle('bg-gray-100', which === 'forgot');
  formLogin.classList.toggle('hidden', which !== 'login');
  formRegister.classList.toggle('hidden', which !== 'register');
  formForgot.classList.toggle('hidden', which !== 'forgot');
  msg.classList.add('hidden');
}

tabLogin.addEventListener('click', () => setTab('login'));
tabRegister.addEventListener('click', () => setTab('register'));
tabForgot.addEventListener('click', () => setTab('forgot'));

// Actions
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = 'index.html';
  } catch (e) {
    showError(e);
  }
});

formRegister.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  
  try {
    // Create user account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Update profile with name
    await updateProfile(user, {
      displayName: name
    });
    
    // Store additional user info in Firestore
    await setDoc(doc(db, 'users', user.uid), {
      name: name,
      email: email,
      role: 'attendant',
      createdAt: new Date()
    });
    
    window.location.href = 'index.html';
  } catch (e) {
    showError(e);
  }
});

formForgot.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();
  try {
    await sendPasswordResetEmail(auth, email);
    msg.textContent = 'Password reset email sent.';
    msg.classList.remove('hidden', 'text-red-600');
    msg.classList.add('text-green-600');
  } catch (e) {
    showError(e);
  }
});

function showError(e) {
  msg.textContent = 'Error: ' + (e?.code || 'unknown');
  msg.classList.remove('hidden', 'text-green-600');
  msg.classList.add('text-red-600');
}

// If already signed in, redirect back to app
onAuthStateChanged(auth, (user) => {
  if (user) {
    // Already signed in
    // window.location.href = 'index.html';
  }
});
