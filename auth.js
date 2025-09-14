// Firebase Auth setup (ESM via CDN)
import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyA7xio2a_7-9ZZTqN7Uc3ZIzipZYnnYj6k",
  authDomain: "pos-system-fa07b.firebaseapp.com",
  projectId: "pos-system-fa07b",
  storageBucket: "pos-system-fa07b.firebasestorage.app",
  messagingSenderId: "88080946373",
  appId: "1:88080946373:web:07bb37c5d8b228de638cac"
};

// Always use the DEFAULT app so auth state is shared across pages
let app;
let auth;
try {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  window.auth = auth;
} catch (error) {
  console.error('Failed to init Firebase', error);
}

// Determine if current page must be protected (all except login.html)
function isProtectedPage() {
  const href = window.location.href;
  return !/login\.html(?:$|\?|#)/i.test(href);
}

onAuthStateChanged(auth, (user) => {
  const logoutBtnMobile = document.getElementById('logout-btn');
  const logoutBtnDesktop = document.getElementById('logout-btn-desktop');
  const signInLink = document.getElementById('signin-link');
  
  const showLogout = !!(user && !user.isAnonymous);

  // Toggle visibility for both logout buttons
  [logoutBtnMobile, logoutBtnDesktop].forEach(btn => {
    if (!btn) return;
    if (showLogout) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
  });

  if (signInLink) {
    if (showLogout) signInLink.classList.add('hidden');
    else signInLink.classList.remove('hidden');
  }
  
  // Enforce authentication on protected pages: no anonymous access
  if (isProtectedPage()) {
    if (!user || user.isAnonymous) {
      if (!/login\.html/i.test(window.location.href)) {
        window.location.replace('login.html');
      }
      return;
    }
  }

  // Only log authentication state during development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    if (user) {
      const name = user.displayName || (user.isAnonymous ? 'Anonymous' : 'User');
      console.log(`🔐 ${name} signed in`);
    } else {
      console.log('👋 Signed out');
    }
  }
});

function attachLogoutHandler(btn) {
  if (!btn) return;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
    try {
      await signOut(auth);
      window.location.href = 'login.html';
    } catch (err) {
      console.error('Logout failed', err);
      alert('Logout failed');
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('opacity-60', 'cursor-not-allowed');
      }, 300);
    }
  });
}

function setupAuthUI() {
  attachLogoutHandler(document.getElementById('logout-btn'));
  attachLogoutHandler(document.getElementById('logout-btn-desktop'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupAuthUI);
} else {
  setupAuthUI();
}

export { auth };
export function getCurrentUserName() {
  const user = auth.currentUser;
  return user?.displayName || 'Staff';
}
