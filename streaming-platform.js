const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TMDB_TOKEN = import.meta.env.VITE_TMDB_TOKEN;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Enhanced state management
let currentUser = null;
let currentMediaType = null;
let currentMediaId = null;
let currentMediaTitle = null;
let currentMediaData = null;
let embedSources = [];
let currentSeason = 1;
let currentEpisode = 1;
let bookmarks = [];
let continueWatching = [];
let searchDebounce = null;
let watchStartTime = null;
let playerInterval = null;
let isPlayerOpen = false;
let featuredMedia = null;
let featuredQueue = [];
let featuredIndex = 0;
let rotationInterval = null;
let rotationPaused = false;

// FIXED: Centralized user status - single source of truth
let isUserApproved = false;

// Performance-optimized DOM caching
const domCache = {
  elements: {},
  observers: new Map()
};

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  try {
    initApp();
    cacheCommonElements();
    setupIntersectionObservers();
    preventBodyScrollWhenNeeded();
  } catch (error) {
    console.error("App initialization failed:", error);
    showNotification("Application failed to load. Please refresh.", "error");
  }
});

function cacheCommonElements() {
  const elements = [
    'auth-container', 'main-header', 'main-content', 'player-modal',
    'video-frame', 'loading-screen', 'notification-container',
    'movies-grid', 'tv-grid', 'mylist-grid', 'search-grid',
    'hero-section', 'player-overlay', 'extension-popup', 'payment-modal',
    'continue-watching-grid', 'continue-watching-row'
  ];
  
  elements.forEach(id => {
    domCache.elements[id] = document.getElementById(id);
  });
}

function setupIntersectionObservers() {
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.classList.remove('lazy');
            imageObserver.unobserve(img);
          }
        }
      });
    }, { rootMargin: '100px 0px', threshold: 0.01 });
    
    domCache.observers.set('images', imageObserver);
  }
}

function preventBodyScrollWhenNeeded() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const playerModal = domCache.elements['player-modal'];
        const paymentModal = domCache.elements['payment-modal'];
        
        if ((playerModal && playerModal.classList.contains('active')) ||
            (paymentModal && paymentModal.classList.contains('active'))) {
          document.body.style.overflow = 'hidden';
          isPlayerOpen = true;
        } else {
          document.body.style.overflow = '';
          isPlayerOpen = false;
        }
      }
    });
  });
  
  if (domCache.elements['player-modal']) {
    observer.observe(domCache.elements['player-modal'], { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
  }
  
  if (domCache.elements['payment-modal']) {
    observer.observe(domCache.elements['payment-modal'], { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
  }
}

// FIXED: Simplified and corrected approval check
async function isAllowedUser(email) {
  try {
    const { data, error } = await supabase
      .from("allowed_users")
      .select("email, approved, expiry_date")
      .eq("email", email)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error("Error checking allowed users:", error);
      return { allowed: false, reason: "error" };
    }

    if (!data) {
      return { allowed: false, reason: "not_found" };
    }

    // Check if approved - must be explicitly true
    if (data.approved !== true) {
      return { allowed: false, reason: "not_approved" };
    }

    // Check if subscription is expired
    if (data.expiry_date) {
      const expiryDate = new Date(data.expiry_date);
      const now = new Date();
      if (expiryDate < now) {
        return { allowed: false, reason: "expired" };
      }
    }

    return { allowed: true, expiryDate: data.expiry_date };
  } catch (error) {
    console.error("Unexpected error checking allowed users:", error);
    return { allowed: false, reason: "error" };
  }
}

function initApp() {
  try {
    setupAuthForms();
    setupNavigation();
    setupGenreFilters();
    setupSearch();
    setupPlayerControls();
    setupAccountModal();
    setupPaymentModal();
    setupLogout();
    setupHeroRotation();
    setupExtensionPopup();
    setupAboutSection();
    setupProfileSystem();
    loadUser();
  } catch (error) {
    console.error("App initialization error:", error);
    showNotification("Error initializing application", "error");
  }
}

function setupPaymentModal() {
  const paymentModal = document.getElementById('payment-modal');
  const openButtons = document.querySelectorAll('#open-payment-modal, #subscribe-link, #pay-now-btn');
  const closeBtn = document.getElementById('payment-close');
  const overlay = paymentModal?.querySelector('.payment-overlay');
  const submitTransactionBtn = document.getElementById('submit-transaction-btn');
  const transactionInput = document.getElementById('transaction-id-input');
  
  openButtons.forEach(btn => {
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      openPaymentModal();
    });
  });
  
  closeBtn?.addEventListener('click', closePaymentModal);
  overlay?.addEventListener('click', closePaymentModal);
  
  if (submitTransactionBtn && transactionInput) {
    submitTransactionBtn.addEventListener('click', async () => {
      const transactionId = transactionInput.value.trim();
      
      if (!transactionId) {
        showNotification("Please enter a transaction ID", "error");
        return;
      }

      if (!currentUser) {
        showNotification("Please log in first", "error");
        return;
      }

      submitTransactionBtn.disabled = true;
      submitTransactionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

      try {
        const { error } = await supabase
          .from('pending_payments')
          .insert({
            user_email: currentUser.email,
            transaction_id: transactionId,
            status: 'pending',
            created_at: new Date().toISOString()
          });

        if (error) throw error;

        showNotification("Transaction ID submitted! We'll verify your payment soon.", "success");
        transactionInput.value = '';
        closePaymentModal();
      } catch (error) {
        console.error("Error submitting transaction:", error);
        showNotification("Failed to submit transaction ID. Please try again.", "error");
      } finally {
        submitTransactionBtn.disabled = false;
        submitTransactionBtn.innerHTML = '<i class="fas fa-check"></i> Submit';
      }
    });
  }
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && paymentModal && paymentModal.classList.contains('active')) {
      closePaymentModal();
    }
  });
}

function openPaymentModal() {
  const modal = document.getElementById('payment-modal');
  if (modal) {
    modal.classList.add('active');
    setTimeout(() => {
      modal.classList.add('show');
    }, 50);
  }
}

function closePaymentModal() {
  const modal = document.getElementById('payment-modal');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => {
      modal.classList.remove('active');
    }, 300);
  }
}

function setupExtensionPopup() {
  const popup = document.getElementById('extension-popup');
  const installBtn = document.getElementById('install-extension-btn');
  const closeBtn = document.getElementById('close-extension-popup');
  
  if (installBtn) {
    installBtn.addEventListener('click', () => {
      window.open('https://chromewebstore.google.com/detail/bkkbcggnhapdmkeljlodobbkopceiche?utm_source=item-share-cb', '_blank');
    });
  }
  
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closeExtensionPopup();
    });
  }
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popup && popup.classList.contains('active')) {
      closeExtensionPopup();
    }
  });
}

function showExtensionPopup() {
  const popup = document.getElementById('extension-popup');
  if (popup) {
    popup.classList.add('active');
    setTimeout(() => {
      popup.classList.add('show');
    }, 50);
  }
}

function closeExtensionPopup() {
  const popup = document.getElementById('extension-popup');
  if (popup) {
    popup.classList.remove('show');
    setTimeout(() => {
      popup.classList.remove('active');
    }, 300);
  }
}

function setupHeroRotation() {
  const heroSection = document.getElementById('hero-section');
  if (heroSection) {
    heroSection.addEventListener('mouseenter', () => {
      if (rotationInterval) {
        clearInterval(rotationInterval);
        rotationInterval = null;
        rotationPaused = true;
      }
    });

    heroSection.addEventListener('mouseleave', () => {
      if (rotationPaused && featuredQueue.length >= 2) {
        startRotation();
        rotationPaused = false;
      }
    });
  }
}

function setupAuthForms() {
  document.getElementById("show-signup")?.addEventListener("click", (e) => {
    e.preventDefault();
    smoothTransition("signin-form", "signup-form");
  });

  document.getElementById("show-signin")?.addEventListener("click", (e) => {
    e.preventDefault();
    smoothTransition("signup-form", "signin-form");
  });

  document.getElementById("show-reset")?.addEventListener("click", (e) => {
    e.preventDefault();
    smoothTransition("signin-form", "reset-form");
  });

  document.getElementById("back-signin")?.addEventListener("click", (e) => {
    e.preventDefault();
    smoothTransition("reset-form", "signin-form");
  });

  setupFormSubmission("signup-form", handleSignup);
  setupFormSubmission("signin-form", handleSignin);
  setupFormSubmission("reset-form", handleReset);
}

function setupFormSubmission(formId, handler) {
  const form = document.getElementById(formId)?.querySelector("form");
  if (form) {
    form.addEventListener("submit", handler);
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  
  submitBtn.textContent = "Creating Account...";
  submitBtn.disabled = true;

  try {
    const email = document.getElementById("signup-email").value;
    const password = document.getElementById("signup-password").value;
    const confirm = document.getElementById("signup-confirm").value;

    if (password !== confirm) {
      showNotification("Passwords do not match", "error");
      return;
    }

    if (password.length < 6) {
      showNotification("Password must be at least 6 characters", "error");
      return;
    }

    const { data, error } = await supabase.auth.signUp({ 
      email, 
      password,
      options: {
        emailRedirectTo: window.location.origin + "/index.html"
      }
    });

    if (error) {
      showNotification(error.message, "error");
    } else {
      showNotification("Sign up successful! Please check your email to confirm your account.", "success");
      smoothTransition("signup-form", "signin-form");
    }
  } catch (error) {
    showNotification("Unexpected error during signup", "error");
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

// FIXED: Proper login flow with correct state management
async function handleSignin(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  submitBtn.textContent = "Signing In...";
  submitBtn.disabled = true;

  try {
    const email = document.getElementById("signin-email").value;
    const password = document.getElementById("signin-password").value;

    // Always allow login attempt first
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      showNotification(error.message, "error");
      return;
    }

    const user = data?.user;
    if (!user) {
      showNotification("Sign-in did not return a user object.", "error");
      return;
    }

    const ok = await registerSessionForUser(user);
    if (!ok) {
      return;
    }

    showNotification("Signed in successfully!", "success");
    
    // FIXED: Wait for loadUser to complete before any UI decisions
    await loadUser();
    
  } catch (error) {
    console.error(error);
    showNotification("Unexpected error during signin", "error");
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

async function handleReset(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  
  submitBtn.textContent = "Sending Reset Link...";
  submitBtn.disabled = true;

  try {
    const email = document.getElementById("reset-email").value;
    const { error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      showNotification(error.message, "error");
    } else {
      showNotification("Reset link sent to your email!", "success");
    }
  } catch (error) {
    showNotification("Unexpected error during password reset", "error");
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

/****************************
 * Single-device session code
 ****************************/

let _sessionChannel = null;
let _heartbeatIntervalId = null;

function getDeviceId() {
  const KEY = 'nf_device_id';
  let d = localStorage.getItem(KEY);
  if (!d) {
    try {
      d = crypto.randomUUID();
    } catch (e) {
      d = Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
    localStorage.setItem(KEY, d);
  }
  return d;
}

async function registerSessionForUser(user) {
  const deviceId = getDeviceId();

  try {
    const { data: existing, error: selErr } = await supabase
      .from('active_sessions')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (selErr) {
      console.error('Error checking active_sessions:', selErr);
    }

    if (existing && existing.is_active && existing.device_id && existing.device_id !== deviceId) {
      await supabase.auth.signOut();
      showNotification("Account already active on another device. Please sign out there first.", "error");
      return false;
    }

    await supabase
      .from('active_sessions')
      .upsert({
        user_id: user.id,
        device_id: deviceId,
        is_active: true,
        session_flag: 'S',
        last_heartbeat: new Date().toISOString()
      }, { returning: 'minimal' });

    startSessionRealtimeSubscription(user.id, deviceId);
    startHeartbeat(user.id, deviceId);

    return true;
  } catch (err) {
    console.error('registerSessionForUser error', err);
    return false;
  }
}

function startHeartbeat(userId, deviceId) {
  stopHeartbeat();
  _heartbeatIntervalId = setInterval(async () => {
    try {
      await supabase
        .from('active_sessions')
        .upsert({
          user_id: userId,
          device_id: deviceId,
          last_heartbeat: new Date().toISOString()
        }, { returning: 'minimal' });
    } catch (e) {
      console.error('heartbeat error', e);
    }
  }, 60_000);
}

function stopHeartbeat() {
  if (_heartbeatIntervalId) {
    clearInterval(_heartbeatIntervalId);
    _heartbeatIntervalId = null;
  }
}

function startSessionRealtimeSubscription(userId, deviceId) {
  if (_sessionChannel) {
    try {
      supabase.removeChannel(_sessionChannel);
    } catch (e) {
      // ignore
    }
    _sessionChannel = null;
  }

  const channelName = `session-channel-${userId}`;
  _sessionChannel = supabase.channel(channelName)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'active_sessions',
      filter: `user_id=eq.${userId}`
    }, (payload) => {
      handleSessionChange(payload, deviceId);
    })
    .subscribe(status => {
      // optional: handle subscribe status
    });
}

function stopSessionRealtimeSubscription() {
  if (!_sessionChannel) return;
  try {
    supabase.removeChannel(_sessionChannel);
  } catch (e) {
    try { _sessionChannel.unsubscribe(); } catch (e2) { }
  }
  _sessionChannel = null;
}

async function handleSessionChange(payload, myDeviceId) {
  try {
    const eventType = payload.eventType || payload.event;
    const newRow = payload.new;
    const oldRow = payload.old;
    const relevantRow = newRow || oldRow;

    if (!relevantRow) return;

    if (eventType === 'DELETE') {
      if (oldRow.device_id === myDeviceId) {
        await forceLocalSignOut("Your session was ended (deleted) – you have been signed out.");
      }
      return;
    }

    if (relevantRow.is_active === false || (relevantRow.session_flag && relevantRow.session_flag.toUpperCase() === 'N')) {
      await forceLocalSignOut("Your session was disabled by admin – you have been signed out.");
      return;
    }

    if (relevantRow.device_id && relevantRow.device_id !== myDeviceId) {
      await forceLocalSignOut("Your account was used on another device – signed out here.");
      return;
    }
  } catch (e) {
    console.error('handleSessionChange error', e);
  }
}

async function forceLocalSignOut(message) {
  stopHeartbeat();
  stopSessionRealtimeSubscription();
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('force signout supabase.auth.signOut failed', e);
  }
  showNotification(message, 'warning');
  showUnauthenticatedUI();
}

async function endSessionForUser(user) {
  try {
    const deviceId = getDeviceId();
    await supabase
      .from('active_sessions')
      .upsert({
        user_id: user.id,
        device_id: deviceId,
        is_active: false,
        session_flag: 'N',
        last_heartbeat: new Date().toISOString()
      }, { returning: 'minimal' });
  } catch (e) {
    console.error('endSessionForUser error', e);
  } finally {
    stopHeartbeat();
    stopSessionRealtimeSubscription();
  }
}

function setupLogout() {
  document.getElementById("logout-link")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      if (rotationInterval) {
        clearInterval(rotationInterval);
        rotationInterval = null;
      }
      const user = currentUser;
      if (user) {
        await endSessionForUser(user);
      }
      await supabase.auth.signOut();
      currentUser = null;
      bookmarks = [];
      continueWatching = [];
      featuredQueue = [];
      featuredIndex = 0;
      isUserApproved = false; // FIXED: Reset approval state
      showNotification("Signed out successfully!", "success");
      showUnauthenticatedUI();
    } catch (error) {
      console.error(error);
      showNotification("Error signing out", "error");
    }
  });
}

function setupNavigation() {
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", debounce((e) => {
      e.preventDefault();
      
      document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
      
      document.querySelectorAll(".content-section").forEach((s) => s.classList.remove("active"));
      
      const targetSection = document.getElementById(`${link.dataset.section}-section`);
      const heroSection = document.getElementById('hero-section');
      
      if (targetSection) {
        targetSection.classList.add("active");
        
        // Hide hero section for About, show for everything else
        if (heroSection) {
          if (link.dataset.section === 'about') {
            heroSection.classList.add('hide-on-about');
            // Stop rotation when leaving home
            if (rotationInterval) {
              clearInterval(rotationInterval);
              rotationInterval = null;
            }
          } else {
            heroSection.classList.remove('hide-on-about');
            // Restart rotation when going back to home
            if (link.dataset.section === 'home' && featuredQueue.length >= 2) {
              if (rotationInterval) {
                clearInterval(rotationInterval);
                rotationInterval = null;
              }
              setTimeout(() => {
                startRotation();
              }, 500);
            }
          }
        }
        
        // Stop rotation for non-home sections
        if (link.dataset.section !== 'home' && rotationInterval) {
          clearInterval(rotationInterval);
          rotationInterval = null;
        }
        
        loadSectionContent(link.dataset.section);
      }
    }, 150));
  });
}

function setupGenreFilters() {
  document.querySelectorAll(".genre-btn").forEach((btn) => {
    btn.addEventListener("click", debounce(() => {
      const activeSection = document.querySelector(".content-section.active");
      if (!activeSection) return;

      const section = activeSection.id;
      const genre = btn.dataset.genre;

      document.querySelectorAll(".genre-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (section === "movies-section") {
        loadMovies(genre);
      } else if (section === "tv-section") {
        loadTVShows(genre);
      } else if (section === "bollywood-section") {  // NEW CONDITION ADDED
        loadBollywoodMovies(genre);
      }
    }, 200));
  });
}

function setupSearch() {
  const searchInput = document.getElementById("main-search-input");
  if (!searchInput) return;

  searchInput.addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      performSearch(e.target.value.trim());
    }, 800);
  });

  document.getElementById("clear-search")?.addEventListener("click", () => {
    searchInput.value = "";
    showHomeSection();
  });
}

function setupPlayerControls() {
  document.getElementById("player-close")?.addEventListener("click", closePlayer);
}

function setupAccountModal() {
  document.getElementById("account-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    const modal = document.getElementById("account-modal");
    if (modal) {
      modal.classList.add("active");
      updateAccountModal();
    }
  });

  document.getElementById("account-close")?.addEventListener("click", () => {
    const modal = document.getElementById("account-modal");
    if (modal) {
      modal.classList.remove("active");
    }
  });
  
  // Close modal on overlay click
  const accountModal = document.getElementById("account-modal");
  if (accountModal) {
    accountModal.addEventListener("click", (e) => {
      if (e.target === accountModal) {
        accountModal.classList.remove("active");
      }
    });
  }
}

function smoothTransition(fromId, toId) {
  const fromElement = document.getElementById(fromId);
  const toElement = document.getElementById(toId);
  
  if (!fromElement || !toElement) return;

  fromElement.classList.add("fade-out");
  setTimeout(() => {
    fromElement.classList.remove("active", "fade-out");
    toElement.classList.add("active", "slide-in-right");
    setTimeout(() => {
      toElement.classList.remove("slide-in-right");
    }, 400);
  }, 150);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// FIXED: Complete rewrite of loadUser with proper state management
async function loadUser() {
  try {
    const { data, error } = await supabase.auth.getUser();
    const user = data?.user;

    const loadingScreen = domCache.elements['loading-screen'];
    if (loadingScreen) {
      loadingScreen.classList.add("fade-out");
      setTimeout(() => {
        loadingScreen.style.display = "none";
      }, 500);
    }

    if (user) {
      currentUser = user;
      
      const accessCheck = await isAllowedUser(user.email);
      isUserApproved = accessCheck.allowed;
      
      console.log('User loaded:', { 
        email: user.email, 
        isUserApproved,
        reason: accessCheck.reason 
      });

      if (!accessCheck.allowed) {
        await registerSessionForUser(user);
        await loadBookmarksFromSupabase();
        await loadContinueWatching();
        await loadUserProfileAndAvatar(); // ADDED: Load profile immediately
        showAuthenticatedUIWithPaymentPrompt(accessCheck.reason);
        return;
      }

      await registerSessionForUser(user);
      await loadBookmarksFromSupabase();
      await loadContinueWatching();
      await updateSubscriptionStatus(accessCheck.expiryDate);
      await loadUserProfileAndAvatar(); // ADDED: Load profile immediately
      showAuthenticatedUI();
      
      const isSpecial = await isSpecialUser(user.email);
      if (isSpecial) {
        setTimeout(() => {
          showHeartAnimation();
        }, 800);
      }
      
      setTimeout(() => {
        showExtensionPopup();
      }, 1000);
    } else {
      currentUser = null;
      isUserApproved = false;
      showUnauthenticatedUI();
    }
  } catch (err) {
    console.error("Error loading user:", err);
    showUnauthenticatedUI();
    showNotification("Error loading user. Please refresh.", "error");
  }
}

async function loadUserProfileAndAvatar() {
  if (!currentUser) return;
  
  try {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('avatar_url')
      .eq('user_id', currentUser.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error loading profile:', error);
      return;
    }

    if (profile && profile.avatar_url) {
      // Update header avatar immediately
      const headerAvatar = document.querySelector('.user-avatar');
      if (headerAvatar) {
        headerAvatar.src = profile.avatar_url + '?t=' + new Date().getTime();
      }
    }
  } catch (error) {
    console.error('Error loading user profile and avatar:', error);
  }
}

// FIXED: Update account modal with current status
function updateAccountModal() {
  const emailEl = document.getElementById('account-email');
  const memberSinceEl = document.getElementById('account-member-since');
  const statusEl = document.getElementById('subscription-status-text');
  
  if (!currentUser) return;

  loadUserProfile();

  if (emailEl) {
    emailEl.textContent = currentUser.email;
  }
  
  if (memberSinceEl) {
    memberSinceEl.textContent = new Date(currentUser.created_at).toLocaleDateString();
  }
  
  if (statusEl) {
    const statusText = isUserApproved ? 'Active' : 'Payment Required';
    const statusClass = isUserApproved ? 'active' : 'pending';
    
    statusEl.textContent = statusText;
    statusEl.className = `subscription-status ${statusClass}`;
  }
}

// FIXED: Complete UI setup for approved users
function showAuthenticatedUI() {
  const { 'auth-container': auth, 'main-header': header, 'main-content': content } = domCache.elements;
  
  if (auth) auth.style.display = "none";
  if (header) header.style.display = "flex";
  if (content) content.style.display = "block";

  // Update settings tab instead of old account elements
  const settingsEmail = document.getElementById("settings-email");
  if (settingsEmail && currentUser) {
    settingsEmail.textContent = currentUser.email;
  }
  
  const settingsMemberSince = document.getElementById("settings-member-since");
  if (settingsMemberSince && currentUser) {
    const date = new Date(currentUser.created_at);
    settingsMemberSince.textContent = date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  // Update subscription status
  const statusText = document.getElementById('settings-subscription-status');
  if (statusText) {
    statusText.textContent = "Active";
    statusText.className = "subscription-status active";
  }

  // Ensure all navigation is visible
  document.querySelectorAll(".nav-link").forEach(link => {
    link.style.display = "block";
  });

  // Make sure hero section is visible on initial load (home page)
  const heroSection = document.getElementById('hero-section');
  if (heroSection) {
    heroSection.classList.remove('hide-on-about');
  }

  // Clear any existing rotation interval before starting fresh
  if (rotationInterval) {
    clearInterval(rotationInterval);
    rotationInterval = null;
  }

  // Load regular content for approved users
  loadSectionContent("home");
}

// FIXED: Proper UI setup for unapproved users  
function showAuthenticatedUIWithPaymentPrompt(reason) {
  const { 'auth-container': auth, 'main-header': header, 'main-content': content } = domCache.elements;
  
  if (auth) auth.style.display = "none";
  if (header) header.style.display = "flex";
  if (content) content.style.display = "block";

  // Update settings tab
  const settingsEmail = document.getElementById("settings-email");
  if (settingsEmail && currentUser) {
    settingsEmail.textContent = currentUser.email;
  }
  
  const settingsMemberSince = document.getElementById("settings-member-since");
  if (settingsMemberSince && currentUser) {
    const date = new Date(currentUser.created_at);
    settingsMemberSince.textContent = date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  // Update subscription status
  const statusText = document.getElementById('settings-subscription-status');
  if (statusText) {
    if (reason === "not_found" || reason === "not_approved") {
      statusText.textContent = "Payment Required";
      statusText.className = "subscription-status pending";
    } else if (reason === "expired") {
      statusText.textContent = "Subscription expired";
      statusText.className = "subscription-status expired";
    }
  }

  // Show notification explaining the situation
  if (reason === "not_found" || reason === "not_approved") {
    showNotification("Please complete payment to access all content", "warning");
  } else if (reason === "expired") {
    showNotification("Your subscription has expired. Please renew.", "warning");
  }

  // Show all navigation but restrict playback
  document.querySelectorAll(".nav-link").forEach(link => {
    link.style.display = "block";
  });

  // Make sure hero section is visible
  const heroSection = document.getElementById('hero-section');
  if (heroSection) {
    heroSection.classList.remove('hide-on-about');
  }

  // Clear any existing rotation
  if (rotationInterval) {
    clearInterval(rotationInterval);
    rotationInterval = null;
  }

  // Load home section with payment prompt
  loadSectionContent("home");
}

async function updateSubscriptionStatus(expiryDate) {
  const statusText = document.getElementById('subscription-status-text');
  if (!statusText || !expiryDate) return;

  const expiry = new Date(expiryDate);
  const now = new Date();
  const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  if (daysRemaining > 0) {
    statusText.textContent = `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`;
    statusText.className = "subscription-status active";
  } else {
    statusText.textContent = "Subscription expired";
    statusText.className = "subscription-status expired";
  }
}

async function loadBookmarksFromSupabase() {
  if (!currentUser) return;
  
  try {
    const { data, error } = await supabase
      .from("user_bookmarks")
      .select("*")
      .eq("user_id", currentUser.id)
      .order('added_at', { ascending: false });

    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        showNotification("Failed to load bookmarks. Table may need to be created.", "warning");
        bookmarks = [];
        return;
      }
      throw error;
    }

    bookmarks = data.map(item => ({
      id: item.media_id,
      media_type: item.media_type,
      title: item.title,
      name: item.title,
      poster_path: item.poster_path,
      vote_average: item.vote_average || 0,
      release_date: item.release_date || "",
      first_air_date: item.first_air_date || ""
    }));
  } catch (error) {
    console.error("Error loading bookmarks:", error);
    showNotification("Failed to load bookmarks. Table may need to be created.", "warning");
    bookmarks = [];
  }
}

async function loadContinueWatching() {
  if (!currentUser) return;
  
  try {
    const { data, error } = await supabase
      .from("continue_watching")
      .select("*")
      .eq("user_id", currentUser.id)
      .eq("completed", false)
      .gte("watch_progress", 60)
      .order('last_watched_at', { ascending: false })
      .limit(12);

    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        console.log("Continue watching table doesn't exist yet");
        continueWatching = [];
        return;
      }
      throw error;
    }

    continueWatching = data.map(item => ({
      id: item.media_id,
      media_type: item.media_type,
      title: item.title,
      name: item.title,
      poster_path: item.poster_path,
      watch_progress: item.watch_progress,
      total_duration: item.total_duration,
      progress_percentage: item.total_duration > 0 ? (item.watch_progress / item.total_duration) * 100 : 0,
      season: item.season || 1,
      episode: item.episode || 1
    }));

    const continueRow = document.getElementById('continue-watching-row');
    if (continueRow) {
      continueRow.style.display = continueWatching.length > 0 ? 'block' : 'none';
    }
  } catch (error) {
    console.error("Error loading continue watching:", error);
    continueWatching = [];
  }
}

function renderContinueWatching() {
  const grid = domCache.elements['continue-watching-grid'];
  if (!grid) return;

  while (grid.firstChild) {
    grid.removeChild(grid.firstChild);
  }

  if (continueWatching.length === 0) {
    const continueRow = document.getElementById('continue-watching-row');
    if (continueRow) continueRow.style.display = 'none';
    return;
  }

  const fragment = document.createDocumentFragment();

  continueWatching.forEach((item, index) => {
    const card = createContinueWatchingCard(item, index);
    fragment.appendChild(card);
  });

  grid.appendChild(fragment);
  setupLazyLoadingForGrid(grid);
}

// FIXED: Use centralized approval check
function createContinueWatchingCard(mediaItem, index) {
  const title = mediaItem.title || mediaItem.name;
  const progressPercent = Math.min(mediaItem.progress_percentage || 0, 100);

  const card = document.createElement("div");
  card.className = "media-card continue-watching-card hover-glow";
  card.style.animationDelay = `${index * 50}ms`;
  card.tabIndex = 0;
  
  const playIcon = isUserApproved ? 'fa-play' : 'fa-lock';
  const playTitle = isUserApproved ? 'Continue watching' : 'Premium access required';
  
  card.innerHTML = `
    <div class="card-image-container">
      <button class="remove-continue-btn" 
              data-id="${mediaItem.id}"
              title="Remove from Continue Watching"
              aria-label="Remove from continue watching">
        <i class="fas fa-times"></i>
      </button>
      <img 
        data-src="https://image.tmdb.org/t/p/w500${mediaItem.poster_path}" 
        alt="${title}"
        class="lazy"
        loading="lazy"
        onerror="this.src='https://via.placeholder.com/500x750?text=No+Image'"
      >
      <div class="card-overlay">
        <button class="play-btn hover-glow" title="${playTitle}">
          <i class="fas ${playIcon}"></i>
        </button>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progressPercent}%"></div>
      </div>
    </div>
    <div class="card-info">
      <h3 class="card-title">${title}</h3>
      <div class="card-meta">
        <span class="continue-progress">${Math.round(progressPercent)}% watched</span>
        <span>${mediaItem.media_type === "tv" ? "TV" : "Movie"}</span>
      </div>
    </div>
  `;

  const playBtn = card.querySelector('.play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isUserApproved) {
        openPlayer({ 
          ...mediaItem, 
          media_type: mediaItem.media_type,
          resumeSeason: mediaItem.season,
          resumeEpisode: mediaItem.episode
        });
      } else {
        showNotification("Premium access required to watch content", "error");
        openPaymentModal();
      }
    });
  }

  card.addEventListener('click', debounce(() => {
    if (isUserApproved) {
      openPlayer({ 
        ...mediaItem, 
        media_type: mediaItem.media_type,
        resumeSeason: mediaItem.season,
        resumeEpisode: mediaItem.episode
      });
    } else {
      showNotification("Premium access required to watch content", "error");
      openPaymentModal();
    }
  }, 300));

  const removeBtn = card.querySelector(".remove-continue-btn");
  if (removeBtn) {
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeContinueWatching(mediaItem.id);
    });
  }

  return card;
}

async function removeContinueWatching(mediaId) {
  if (!currentUser) return;

  try {
    const { error } = await supabase
      .from("continue_watching")
      .delete()
      .eq("user_id", currentUser.id)
      .eq("media_id", mediaId);

    if (error) throw error;

    continueWatching = continueWatching.filter(item => item.id !== mediaId);
    renderContinueWatching();
    showNotification("Removed from Continue Watching", "success");
  } catch (error) {
    console.error("Error removing from continue watching:", error);
    showNotification("Failed to remove item", "error");
  }
}

async function updateWatchProgress(mediaItem, currentTime, duration) {
  if (!currentUser || !mediaItem || currentTime < 60) return;

  try {
    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
    const completed = progressPercent > 90;

    const { error } = await supabase
      .from("continue_watching")
      .upsert({
        user_id: currentUser.id,
        media_id: mediaItem.id,
        media_type: mediaItem.media_type,
        title: mediaItem.title || mediaItem.name,
        poster_path: mediaItem.poster_path,
        watch_progress: Math.floor(currentTime),
        total_duration: Math.floor(duration),
        last_watched_at: new Date().toISOString(),
        completed: completed,
        season: mediaItem.media_type === 'tv' ? currentSeason : null,
        episode: mediaItem.media_type === 'tv' ? currentEpisode : null
      }, { 
        onConflict: 'user_id,media_id',
        returning: 'minimal' 
      });

    if (error) throw error;
  } catch (error) {
    console.error("Error updating watch progress:", error);
  }
}

function showUnauthenticatedUI() {
  const { 'auth-container': auth, 'main-header': header, 'main-content': content } = domCache.elements;
  
  if (auth) auth.style.display = "flex";
  if (header) header.style.display = "none";
  if (content) content.style.display = "none";
}

function showHomeSection() {
  document.querySelectorAll(".content-section").forEach((s) => s.classList.remove("active"));
  document.getElementById("home-section")?.classList.add("active");
  
  document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
  document.querySelector('[data-section="home"]')?.classList.add("active");
}

function loadSectionContent(section) {
  showLoadingForSection(section);
  
  switch (section) {
    case "home":
      Promise.all([
        loadFeaturedContent(),
        loadTrending(),
        loadPopularMovies(),
        loadPopularTVShows()
      ]).then(() => {
        renderContinueWatching();
      }).finally(() => {
        hideLoadingForSection(section);
        const homeSection = document.getElementById("home-section");
        if (homeSection && homeSection.classList.contains('active') && featuredQueue.length >= 2) {
          // Make sure any existing rotation is cleared first
          if (rotationInterval) {
            clearInterval(rotationInterval);
            rotationInterval = null;
          }
          // Start rotation after a short delay
          setTimeout(() => {
            startRotation();
          }, 1000);
        }
      });
      break;
    case "movies":
      loadMovies("all").finally(() => hideLoadingForSection(section));
      break;
    case "tv":
      loadTVShows("all").finally(() => hideLoadingForSection(section));
      break;
    case "bollywood":
      loadBollywoodMovies("all").finally(() => hideLoadingForSection(section));
      break;
    case "mylist":
      loadBookmarks();
      hideLoadingForSection(section);
      break;
    case "about":
      // About section is static, just hide loading and setup animations
      hideLoadingForSection(section);
      setupScrollAnimations();
      break;
  }
}

async function loadBollywoodMovies(genre) {
  try {
    let url = "https://api.themoviedb.org/3/discover/movie?sort_by=vote_average.desc&vote_count.gte=100&with_original_language=hi";
    
    if (genre !== "all") {
      url += `&with_genres=${genre}`;
    }

    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${TMDB_TOKEN}`,
        "Content-Type": "application/json;charset=utf-8",
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    // Filter out adult content and ensure Hindi language
    const bollywoodMovies = data.results.filter(movie => 
      !movie.adult && 
      movie.original_language === 'hi' &&
      movie.vote_count >= 100
    );
    
    renderMediaCards(bollywoodMovies, "bollywood-grid");
  } catch (error) {
    console.error("Error loading Bollywood movies:", error);
    showNotification("Error loading Bollywood movies", "error");
  }
}

function showLoadingForSection(section) {
  const sectionElement = document.getElementById(`${section}-section`);
  if (sectionElement && !sectionElement.querySelector('.loading-indicator')) {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-indicator';
    loadingDiv.innerHTML = '<div class="spinner"></div><p>Loading content...</p>';
    sectionElement.appendChild(loadingDiv);
  }
}

function hideLoadingForSection(section) {
  const sectionElement = document.getElementById(`${section}-section`);
  const loadingIndicator = sectionElement?.querySelector('.loading-indicator');
  if (loadingIndicator) {
    loadingIndicator.remove();
  }
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function loadFeaturedContent() {
  try {
    const response = await fetchWithTimeout(
      "https://api.themoviedb.org/3/movie/popular?language=en-US&page=1",
      {
        headers: {
          Authorization: `Bearer ${TMDB_TOKEN}`,
          "Content-Type": "application/json;charset=utf-8",
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    const currentYear = new Date().getFullYear();
    const filteredResults = data.results.filter(movie => {
      const releaseYear = movie.release_date ? parseInt(movie.release_date.split('-')[0]) : 0;
      return movie.adult === false && 
             movie.vote_average >= 7.0 && 
             releaseYear >= 2020;
    });
    
    featuredQueue = filteredResults.slice(0, 5);
    
    if (featuredQueue.length > 0) {
      featuredIndex = Math.floor(Math.random() * featuredQueue.length);
      featuredMedia = featuredQueue[featuredIndex];
      updateHeroSection(featuredMedia);
      
      // FIXED: Start rotation immediately if we have enough items
      if (featuredQueue.length >= 2) {
        // Clear any existing interval first
        if (rotationInterval) {
          clearInterval(rotationInterval);
          rotationInterval = null;
        }
        // Start rotation with a small delay to ensure DOM is ready
        setTimeout(() => {
          startRotation();
        }, 500);
      }
    }
  } catch (error) {
    console.error("Error loading featured content:", error);
  }
}

function startRotation() {
  if (rotationInterval || featuredQueue.length < 2) return;
  
  rotationInterval = setInterval(() => {
    rotateFeatured();
  }, 5000);
}

function rotateFeatured() {
  if (featuredQueue.length < 2) return;
  
  const heroContent = document.querySelector('.hero-content');
  const heroBackdrop = document.querySelector('.hero-backdrop');
  
  if (heroContent) heroContent.style.opacity = '0';
  if (heroBackdrop) heroBackdrop.style.opacity = '0';
  
  setTimeout(() => {
    featuredIndex = (featuredIndex + 1) % featuredQueue.length;
    featuredMedia = featuredQueue[featuredIndex];
    updateHeroSection(featuredMedia);
    
    if (heroContent) heroContent.style.opacity = '1';
    if (heroBackdrop) heroBackdrop.style.opacity = '0.3';
  }, 800);
}

// FIXED: Hero section with centralized approval check
function updateHeroSection(media) {
  const heroBackdrop = document.querySelector('.hero-backdrop');
  const heroTitle = document.getElementById('hero-title');
  const heroMeta = document.getElementById('hero-meta');
  const heroDescription = document.getElementById('hero-description');
  const heroWatchBtn = document.getElementById('hero-watch-btn');
  const heroBookmarkBtn = document.getElementById('hero-bookmark-btn-new');

  if (heroBackdrop && media.backdrop_path) {
    heroBackdrop.style.backgroundImage = `url(https://image.tmdb.org/t/p/original${media.backdrop_path})`;
    heroBackdrop.style.opacity = '0.3';
  }

  if (heroTitle) {
    heroTitle.textContent = media.title || media.name;
  }

  if (heroMeta) {
    const rating = media.vote_average ? media.vote_average.toFixed(1) : 'N/A';
    const year = (media.release_date || media.first_air_date || '').split('-')[0];
    const mediaType = media.media_type === 'tv' ? 'TV Show' : 'Movie';
    
    const genres = media.genre_ids ? 
      media.genre_ids.slice(0, 2).map(id => getGenreName(id)).filter(Boolean).join(', ') : 
      'Action, Adventure';
    
    heroMeta.innerHTML = `
      <span class="hero-rating"><i class="fas fa-star"></i> ${rating}</span>
      <span>${year || 'N/A'}</span>
      <span>${genres || mediaType}</span>
    `;
  }

  if (heroDescription) {
    const description = media.overview || 'No description available';
    heroDescription.textContent = description.length > 250 
      ? description.substring(0, 250) + '...' 
      : description;
  }

  // FIXED: Hero watch button based on centralized approval
  if (heroWatchBtn) {
    if (isUserApproved) {
      heroWatchBtn.innerHTML = '<i class="fas fa-play"></i> Watch Now';
      heroWatchBtn.onclick = () => {
        openPlayer({ ...media, media_type: media.media_type || 'movie' });
      };
    } else {
      heroWatchBtn.innerHTML = '<i class="fas fa-lock"></i> Premium Required';
      heroWatchBtn.onclick = () => {
        showNotification("Subscribe to unlock premium content", "error");
        openPaymentModal();
      };
    }
  }

  // FIXED: Bookmark button with approval check
  if (heroBookmarkBtn && currentUser) {
    const isBookmarked = bookmarks.some(b => b.id === media.id);
    const icon = heroBookmarkBtn.querySelector('i');
    const span = heroBookmarkBtn.querySelector('span');
    
    heroBookmarkBtn.classList.add('show');
    
    if (isBookmarked) {
      icon.className = 'fas fa-bookmark';
      heroBookmarkBtn.classList.add('bookmarked');
      if (span) span.textContent = 'Remove from List';
    } else {
      icon.className = 'far fa-bookmark';
      heroBookmarkBtn.classList.remove('bookmarked');
      if (span) span.textContent = 'Add to List';
    }
    
    heroBookmarkBtn.onclick = () => {
      if (isUserApproved) {
        toggleBookmark(media, media.media_type || 'movie', heroBookmarkBtn);
      } else {
        showNotification("Subscribe to use bookmark feature", "error");
        openPaymentModal();
      }
    };
  } else if (heroBookmarkBtn) {
    heroBookmarkBtn.classList.remove('show');
  }
}

function getGenreName(id) {
  const genreMap = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
    99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
    27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
    10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action',
    10765: 'Sci-Fi'
  };
  return genreMap[id] || '';
}

async function loadTrending() {
  try {
    const response = await fetchWithTimeout(
      "https://api.themoviedb.org/3/trending/all/week",
      {
        headers: {
          Authorization: `Bearer ${TMDB_TOKEN}`,
          "Content-Type": "application/json;charset=utf-8",
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    renderMediaCards(data.results.slice(0, 12), "trending-grid");
  } catch (error) {
    console.error("Error loading trending:", error);
    showNotification("Error loading trending content", "error");
  }
}

async function loadPopularMovies() {
  try {
    const response = await fetchWithTimeout(
      "https://api.themoviedb.org/3/movie/popular",
      {
        headers: {
          Authorization: `Bearer ${TMDB_TOKEN}`,
          "Content-Type": "application/json;charset=utf-8",
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    renderMediaCards(data.results.slice(0, 12), "popular-movies-grid");
  } catch (error) {
    console.error("Error loading popular movies:", error);
    showNotification("Error loading popular movies", "error");
  }
}

async function loadPopularTVShows() {
  try {
    const response = await fetchWithTimeout(
      "https://api.themoviedb.org/3/tv/popular",
      {
        headers: {
          Authorization: `Bearer ${TMDB_TOKEN}`,
          "Content-Type": "application/json;charset=utf-8",
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    renderMediaCards(data.results.slice(0, 12), "popular-tv-grid");
  } catch (error) {
    console.error("Error loading popular TV shows:", error);
    showNotification("Error loading popular TV shows", "error");
  }
}

async function loadMovies(genre) {
  try {
    let url = "https://api.themoviedb.org/3/discover/movie?sort_by=popularity.desc";
    if (genre !== "all") {
      url += `&with_genres=${genre}`;
    }

    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${TMDB_TOKEN}`,
        "Content-Type": "application/json;charset=utf-8",
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    renderMediaCards(data.results, "movies-grid");
  } catch (error) {
    console.error("Error loading movies:", error);
    showNotification("Error loading movies", "error");
  }
}

async function loadTVShows(genre) {
  try {
    let url = "https://api.themoviedb.org/3/discover/tv?sort_by=popularity.desc";
    if (genre !== "all") {
      url += `&with_genres=${genre}`;
    }

    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${TMDB_TOKEN}`,
        "Content-Type": "application/json;charset=utf-8",
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    renderMediaCards(data.results, "tv-grid");
  } catch (error) {
    console.error("Error loading TV shows:", error);
    showNotification("Error loading TV shows", "error");
  }
}

function renderMediaCards(mediaItems, gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  while (grid.firstChild) {
    grid.removeChild(grid.firstChild);
  }

  if (!mediaItems || mediaItems.length === 0) {
    grid.innerHTML = "<p class='no-content'>No content available</p>";
    return;
  }

  const fragment = document.createDocumentFragment();

  mediaItems.forEach((item, index) => {
    const mediaType = item.media_type || (item.first_air_date ? "tv" : "movie");
    const card = createMediaCard(item, mediaType, index);
    fragment.appendChild(card);
  });

  grid.appendChild(fragment);
  setupLazyLoadingForGrid(grid);
}

// FIXED: Media card with centralized approval check
function createMediaCard(mediaItem, mediaType, index) {
  const title = mediaItem.title || mediaItem.name;
  const year = (mediaItem.release_date || mediaItem.first_air_date || "").split("-")[0];
  const rating = mediaItem.vote_average ? mediaItem.vote_average.toFixed(1) : "N/A";
  const isBookmarked = bookmarks.some((b) => b.id === mediaItem.id);

  // FIXED: Use centralized approval check
  const playIcon = isUserApproved ? 'fa-play' : 'fa-lock';
  const playTitle = isUserApproved ? `Play ${title}` : 'Premium access required';

  const card = document.createElement("div");
  card.className = "media-card hover-glow";
  card.style.animationDelay = `${index * 50}ms`;
  card.tabIndex = 0;
  
  // FIXED: Only show bookmark for approved users
  const bookmarkButton = (currentUser && isUserApproved) ? `
    <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" 
            data-id="${mediaItem.id}"
            title="${isBookmarked ? 'Remove from List' : 'Add to List'}"
            aria-label="${isBookmarked ? 'Remove from bookmarks' : 'Add to bookmarks'}">
      <i class="${isBookmarked ? 'fas' : 'far'} fa-bookmark"></i>
    </button>
  ` : '';
  
  card.innerHTML = `
    <div class="card-image-container">
      ${bookmarkButton}
      <img 
        data-src="https://image.tmdb.org/t/p/w500${mediaItem.poster_path}" 
        alt="${title}"
        class="lazy"
        loading="lazy"
        onerror="this.src='https://via.placeholder.com/500x750?text=No+Image'"
      >
      <div class="card-overlay">
        <button class="play-btn hover-glow" title="${playTitle}">
          <i class="fas ${playIcon}"></i>
        </button>
      </div>
    </div>
    <div class="card-info">
      <h3 class="card-title">${title}</h3>
      <div class="card-meta">
        <span class="card-rating">
          <i class="fas fa-star"></i>
          ${rating}
        </span>
        <span>${year}</span>
        <span>${mediaType === "tv" ? "TV" : "Movie"}</span>
      </div>
    </div>
  `;

  const playBtn = card.querySelector('.play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isUserApproved) {
        openPlayer({ ...mediaItem, media_type: mediaType });
      } else {
        showNotification("Premium access required to watch content", "error");
        openPaymentModal();
      }
    });
  }

  card.addEventListener('click', debounce(() => {
    if (isUserApproved) {
      openPlayer({ ...mediaItem, media_type: mediaType });
    } else {
      showNotification("Premium access required to watch content", "error");
      openPaymentModal();
    }
  }, 300));

  card.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isUserApproved) {
        openPlayer({ ...mediaItem, media_type: mediaType });
      } else {
        showNotification("Premium access required to watch content", "error");
        openPaymentModal();
      }
    }
  });

  const bookmarkBtn = card.querySelector(".bookmark-btn");
  if (bookmarkBtn) {
    bookmarkBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isUserApproved) {
        animateButton(bookmarkBtn);
        toggleBookmark(mediaItem, mediaType, bookmarkBtn);
      } else {
        showNotification("Subscribe to use bookmark feature", "error");
        openPaymentModal();
      }
    });
  }

  return card;
}

function setupLazyLoadingForGrid(grid) {
  const imageObserver = domCache.observers.get('images');
  if (imageObserver) {
    grid.querySelectorAll('img.lazy').forEach(img => {
      imageObserver.observe(img);
    });
  }
}

function animateButton(button) {
  button.style.transform = "scale(0.9)";
  setTimeout(() => {
    button.style.transform = "scale(1)";
  }, 150);
}

function loadBookmarks() {
  const grid = document.getElementById("mylist-grid");
  if (!grid) return;

  if (bookmarks.length === 0) {
    grid.innerHTML = `
      <div class="no-content">
        <i class="fas fa-bookmark"></i>
        <p>No items in your list yet. Add some movies or TV shows!</p>
      </div>
    `;
    return;
  }

  renderMediaCards(bookmarks, "mylist-grid");
}

function toggleBookmark(mediaItem, mediaType, button) {
  if (!currentUser) {
    showNotification("Please log in to manage your list", "error");
    return;
  }

  // FIXED: Check approval before allowing bookmark
  if (!isUserApproved) {
    showNotification("Subscribe to use bookmark feature", "error");
    openPaymentModal();
    return;
  }

  const index = bookmarks.findIndex((b) => b.id === mediaItem.id);
  const icon = button.querySelector("i");

  if (index > -1) {
    bookmarks.splice(index, 1);
    showNotification("Removed from your list", "success");
    removeBookmarkFromSupabase(mediaItem.id);
    
    if (icon) {
      icon.className = "far fa-bookmark";
    }
    button.classList.remove("bookmarked");
    button.title = "Add to List";
  } else {
    bookmarks.push({ ...mediaItem, media_type: mediaType });
    showNotification("Added to your list", "success");
    addBookmarkToSupabase(mediaItem, mediaType);
    
    if (icon) {
      icon.className = "fas fa-bookmark";
    }
    button.classList.add("bookmarked");
    button.title = "Remove from List";
  }

  if (document.getElementById("mylist-section")?.classList.contains("active")) {
    loadBookmarks();
  }
  
  if (featuredMedia && featuredMedia.id === mediaItem.id) {
    updateHeroSection(featuredMedia);
  }
}

async function addBookmarkToSupabase(mediaItem, mediaType) {
  try {
    const { error } = await supabase.from("user_bookmarks").insert({
      user_id: currentUser.id,
      media_id: mediaItem.id,
      media_type: mediaType,
      title: mediaItem.title || mediaItem.name,
      poster_path: mediaItem.poster_path,
      vote_average: mediaItem.vote_average,
      release_date: mediaItem.release_date || null,
      first_air_date: mediaItem.first_air_date || null,
      added_at: new Date().toISOString(),
    });

    if (error) throw error;
  } catch (error) {
    console.error("Error adding bookmark to Supabase:", error);
  }
}

async function removeBookmarkFromSupabase(mediaId) {
  try {
    const { error } = await supabase
      .from("user_bookmarks")
      .delete()
      .eq("user_id", currentUser.id)
      .eq("media_id", mediaId);

    if (error) throw error;
  } catch (error) {
    console.error("Error removing bookmark from Supabase:", error);
  }
}

async function performSearch(query) {
  if (!query.trim()) {
    showHomeSection();
    return;
  }

  try {
    showLoadingForSection("search");
    
    const response = await fetchWithTimeout(
      `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bearer ${TMDB_TOKEN}`,
          "Content-Type": "application/json;charset=utf-8",
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const results = data.results.filter(
      (item) => !item.adult && (item.media_type === "movie" || item.media_type === "tv") && item.poster_path
    );

    if (currentUser) {
      recordSearchHistory(query);
    }

    document.querySelectorAll(".content-section").forEach((s) => s.classList.remove("active"));
    document.getElementById("search-section")?.classList.add("active");
    renderMediaCards(results, "search-grid");
    
    setTimeout(() => {
      const searchSection = document.getElementById("search-section");
      if (searchSection) {
        const headerHeight = document.querySelector('.main-header')?.offsetHeight || 80;
        const targetPosition = searchSection.offsetTop - headerHeight - 20;
        
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    }, 100);
    
  } catch (error) {
    console.error("Error searching:", error);
    showNotification("Error performing search", "error");
  } finally {
    hideLoadingForSection("search");
  }
}

async function recordSearchHistory(query) {
  try {
    const { error } = await supabase.from("user_search_history").insert({
      user_id: currentUser.id,
      query: query,
      searched_at: new Date().toISOString(),
    });

    if (error) throw error;
  } catch (error) {
    console.error("Error recording search history:", error);
  }
}

async function recordWatchHistory(mediaItem, season = null, episode = null, duration = 0) {
  try {
    const { error } = await supabase.from("user_watch_history").insert({
      user_id: currentUser.id,
      media_id: mediaItem.id,
      media_type: mediaItem.media_type,
      title: mediaItem.title || mediaItem.name,
      season: season,
      episode: episode,
      duration: duration,
      watched_at: new Date().toISOString(),
    });

    if (error) throw error;
  } catch (error) {
    console.error("Error recording watch history:", error);
  }
}

// FIXED: Centralized approval check in openPlayer
function openPlayer(mediaItem) {
  if (!currentUser) {
    showNotification("Please log in to stream content", "error");
    return;
  }

  // FIXED: Immediate approval check with clear feedback
  if (!isUserApproved) {
    showNotification("Premium access required to watch content. Please subscribe to continue.", "error");
    openPaymentModal();
    return;
  }

  currentMediaType = mediaItem.media_type;
  currentMediaId = mediaItem.id;
  currentMediaTitle = mediaItem.title || mediaItem.name;
  currentMediaData = mediaItem;

  document.getElementById("player-title").textContent = currentMediaTitle;
  document.getElementById("player-description").textContent = mediaItem.overview || "No description available";

  const ratingValue = document.getElementById("player-rating-value");
  const playerYear = document.getElementById("player-year");
  const playerType = document.getElementById("player-type");

  if (ratingValue) {
    ratingValue.textContent = mediaItem.vote_average ? mediaItem.vote_average.toFixed(1) : "N/A";
  }

  if (playerYear) {
    const year = (mediaItem.release_date || mediaItem.first_air_date || "").split("-")[0];
    playerYear.textContent = year || "N/A";
  }

  if (playerType) {
    playerType.textContent = currentMediaType === "tv" ? "TV Show" : "Movie";
  }

  const tvControls = document.getElementById("tv-controls");
  if (tvControls) {
    tvControls.style.display = currentMediaType === "tv" ? "flex" : "none";
  }

  if (currentMediaType === "tv") {
    currentSeason = mediaItem.resumeSeason || 1;
    currentEpisode = mediaItem.resumeEpisode || 1;
    loadSeasons(currentMediaId);
  }

  buildEmbedSources();
  populateSourceButtons();
  loadSource(0);

  watchStartTime = new Date();

  if (playerInterval) clearInterval(playerInterval);
  playerInterval = setInterval(() => {
    trackPlayerProgress();
  }, 30000);

  const playerModal = domCache.elements['player-modal'];
  if (playerModal) {
    playerModal.classList.add("active");
    setTimeout(() => {
      playerModal.classList.add("opened");
    }, 50);
  }
}

function trackPlayerProgress() {
  if (!currentUser || !currentMediaData) return;
  
  const iframe = domCache.elements['video-frame'];
  if (!iframe || !iframe.src) return;
  
  const currentTime = watchStartTime ? (new Date() - watchStartTime) / 1000 : 0;
  const estimatedDuration = currentMediaType === 'movie' ? 7200 : 2700;
  
  if (currentTime > 60) {
    updateWatchProgress(currentMediaData, currentTime, estimatedDuration);
  }
}

function closePlayer() {
  if (watchStartTime && currentUser && currentMediaData) {
    const watchEndTime = new Date();
    const watchDuration = (watchEndTime - watchStartTime) / 1000;
    
    if (watchDuration > 30) {
      const mediaItem = {
        id: currentMediaId,
        media_type: currentMediaType,
        title: currentMediaTitle,
      };
      recordWatchHistory(
        mediaItem,
        currentMediaType === 'tv' ? currentSeason : null,
        currentMediaType === 'tv' ? currentEpisode : null,
        watchDuration
      );
      
      const estimatedDuration = currentMediaType === 'movie' ? 7200 : 2700;
      updateWatchProgress(currentMediaData, watchDuration, estimatedDuration);
      
      // Update watch time stats and check badges
      updateWatchTimeStats(currentMediaType, watchDuration, currentMediaData.genre_ids);
    }
  }

  cleanupPlayer();
  
  const playerModal = domCache.elements['player-modal'];
  if (playerModal) {
    playerModal.classList.remove('opened');
    setTimeout(() => {
      playerModal.classList.remove('active');
      document.body.style.overflow = '';
    }, 300);
  }
  
  if (document.getElementById('home-section')?.classList.contains('active')) {
    loadContinueWatching().then(() => renderContinueWatching());
  }
}

function cleanupPlayer() {
  if (playerInterval) {
    clearInterval(playerInterval);
    playerInterval = null;
  }

  const iframe = domCache.elements['video-frame'];
  if (iframe) {
    iframe.src = 'about:blank';
  }
  
  if (currentMediaType === 'tv') {
    currentSeason = 1;
    currentEpisode = 1;
  }
  
  watchStartTime = null;
}

function buildEmbedSources() {
  if (currentMediaType === "movie") {
    embedSources = [
      { name: "Source 1", url: `https://111movies.com/movie/${currentMediaId}` },
      { name: "Source 2", url: `https://player.videasy.net/movie/${currentMediaId}` },
      { name: "Source 3", url: `https://vidsrc.xyz/embed/movie/${currentMediaId}` },
      { name: "Source 4", url: `https://vidsrc.me/embed/movie/${currentMediaId}` },
    ];
  } else if (currentMediaType === "tv") {
    embedSources = [
      { name: "Source 1", url: `https://111movies.com/tv/${currentMediaId}/${currentSeason}/${currentEpisode}` },
      { name: "Source 2", url: `https://player.videasy.net/tv/${currentMediaId}/${currentSeason}/${currentEpisode}` },
      { name: "Source 3", url: `https://vidsrc.xyz/embed/tv/${currentMediaId}/${currentSeason}/${currentEpisode}` },
      { name: "Source 4", url: `https://vidsrc.me/embed/tv/${currentMediaId}/${currentSeason}/${currentEpisode}` },
    ];
  }
}

function populateSourceButtons() {
  const sourceButtons = document.getElementById("source-buttons");
  if (!sourceButtons) return;

  sourceButtons.innerHTML = "";

  embedSources.forEach((source, index) => {
    const button = document.createElement("button");
    button.className = "source-btn hover-glow";
    if (index === 0) button.classList.add("active");
    button.textContent = source.name;
    button.style.animationDelay = `${index * 100}ms`;
    
    button.addEventListener("click", debounce(() => {
      document.querySelectorAll(".source-btn").forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      loadSource(index);
    }, 200));

    sourceButtons.appendChild(button);
  });
}

function loadSource(index) {
  if (index < 0 || index >= embedSources.length) return;

  const source = embedSources[index];
  const iframe = domCache.elements['video-frame'];
  
  if (!iframe) return;

  iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
  iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');

  showVideoLoadingState();

  let retryCount = 0;
  const maxRetries = 2;

  function attemptLoad() {
    iframe.onerror = () => {
      retryCount++;
      if (retryCount <= maxRetries) {
        showNotification(`Retrying ${source.name}... (${retryCount}/${maxRetries})`, 'warning');
        setTimeout(attemptLoad, 1000 * retryCount);
      } else {
        handleSourceFailure(index);
      }
    };

    iframe.onload = () => {
      hideVideoLoadingState();
    };

    iframe.src = source.url + (source.url.includes('?') ? '&' : '?') + 't=' + Date.now();
  }

  const loadTimeout = setTimeout(() => {
    if (iframe.src && !iframe.contentWindow?.length) {
      handleSourceFailure(index);
    }
  }, 10000);

  iframe.addEventListener('load', () => clearTimeout(loadTimeout), { once: true });

  attemptLoad();
}

function handleSourceFailure(currentIndex) {
  hideVideoLoadingState();
  
  const nextIndex = (currentIndex + 1) % embedSources.length;
  if (nextIndex !== currentIndex) {
    showNotification(`Trying ${embedSources[nextIndex].name}...`, 'warning');
    setTimeout(() => loadSource(nextIndex), 1000);
  } else {
    showNotification('All sources failed. Please try again later.', 'error');
  }
}

function showVideoLoadingState() {
  const playerVideoSection = document.querySelector('.player-video-section');
  if (playerVideoSection && !playerVideoSection.querySelector('.video-loading')) {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'video-loading';
    loadingDiv.innerHTML = `
      <div class="video-spinner"></div>
      <p>Loading video source...</p>
    `;
    playerVideoSection.appendChild(loadingDiv);
  }
}

function hideVideoLoadingState() {
  const loadingDiv = document.querySelector('.video-loading');
  if (loadingDiv) {
    loadingDiv.remove();
  }
}

async function loadSeasons(showId) {
  try {
    const response = await fetchWithTimeout(
      `https://api.themoviedb.org/3/tv/${showId}`,
      {
        headers: {
          Authorization: `Bearer ${TMDB_TOKEN}`,
          "Content-Type": "application/json;charset=utf-8",
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const seasons = data.seasons.filter((season) => season.season_number > 0);

    const seasonSelect = document.getElementById("season-select");
    if (!seasonSelect) return;

    seasonSelect.innerHTML = "";

    seasons.forEach((season) => {
      const option = document.createElement("option");
      option.value = season.season_number;
      option.textContent = `Season ${season.season_number}`;
      if (season.season_number === currentSeason) {
        option.selected = true;
      }
      seasonSelect.appendChild(option);
    });

    seasonSelect.addEventListener("change", debounce((e) => {
      currentSeason = parseInt(e.target.value);
      currentEpisode = 1;
      reloadTVContent();
    }, 300));

    await loadEpisodes(showId, currentSeason);
  } catch (error) {
    console.error("Error loading seasons:", error);
    showNotification("Error loading seasons", "error");
  }
}

async function loadEpisodes(showId, seasonNumber) {
  try {
    const response = await fetchWithTimeout(
      `https://api.themoviedb.org/3/tv/${showId}/season/${seasonNumber}`,
      {
        headers: {
          Authorization: `Bearer ${TMDB_TOKEN}`,
          "Content-Type": "application/json;charset=utf-8",
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    renderEpisodeCards(data.episodes);
  } catch (error) {
    console.error("Error loading episodes:", error);
    showNotification("Error loading episodes", "error");
  }
}

function renderEpisodeCards(episodes) {
  const episodesList = document.getElementById("episodes-list");
  if (!episodesList) return;

  episodesList.innerHTML = "";

  if (!episodes || episodes.length === 0) {
    episodesList.innerHTML = "<p class='no-episodes'>No episodes available</p>";
    return;
  }

  const fragment = document.createDocumentFragment();

  episodes.forEach((episode, index) => {
    const episodeCard = document.createElement("div");
    episodeCard.className = `episode-card hover-glow ${episode.episode_number === currentEpisode ? "active" : ""}`;
    episodeCard.style.animationDelay = `${index * 50}ms`;
    
    episodeCard.innerHTML = `
      <div class="episode-number">${episode.episode_number}</div>
      <div class="episode-info">
        <div class="episode-title">${episode.name || `Episode ${episode.episode_number}`}</div>
        <div class="episode-meta">
          ${episode.runtime ? `${episode.runtime}m • ` : ''}
          ${episode.air_date ? new Date(episode.air_date).getFullYear() : 'TBA'}
        </div>
      </div>
    `;

    episodeCard.addEventListener("click", debounce(() => {
      document.querySelectorAll(".episode-card").forEach((card) => card.classList.remove("active"));
      episodeCard.classList.add("active");
      currentEpisode = episode.episode_number;
      reloadTVContent();
    }, 300));

    fragment.appendChild(episodeCard);
  });

  episodesList.appendChild(fragment);
}



function reloadTVContent() {
  showVideoLoadingState();
  buildEmbedSources();
  populateSourceButtons();
  loadSource(0);
  watchStartTime = new Date();
}

function showNotification(message, type = "success") {
  const container = document.getElementById('notification-container');
  if (!container) return;

  const notification = document.createElement("div");
  notification.className = `notification ${type} slide-in-right`;
  notification.setAttribute('role', 'alert');
  notification.innerHTML = `
    <i class="notification-icon fas ${
      type === "success" ? "fa-check-circle" : 
      type === "error" ? "fa-exclamation-circle" : "fa-exclamation-triangle"
    }"></i>
    <span>${message}</span>
    <button class="notification-close" aria-label="Close notification">
      <i class="fas fa-times"></i>
    </button>
  `;

  container.appendChild(notification);

  setTimeout(() => notification.classList.add("show"), 100);

  const autoRemove = setTimeout(() => {
    removeNotification(notification);
  }, 5000);

  const closeBtn = notification.querySelector('.notification-close');
  closeBtn.addEventListener('click', () => {
    clearTimeout(autoRemove);
    removeNotification(notification);
  });

  notification.addEventListener('click', (e) => {
    if (e.target === notification || e.target.closest('.notification-close')) {
      clearTimeout(autoRemove);
      removeNotification(notification);
    }
  });
}

function removeNotification(notification) {
  notification.classList.add("fade-out");
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 300);
}

document.addEventListener('keydown', (e) => {
  if (!isPlayerOpen) return;
  
  switch(e.key) {
    case 'Escape':
      closePlayer();
      break;
  }
});

let scrollTimeout;
window.addEventListener('scroll', () => {
  if (!scrollTimeout) {
    scrollTimeout = setTimeout(() => {
      const header = domCache.elements['main-header'];
      if (header) {
        header.classList.toggle('scrolled', window.scrollY > 50);
      }
      scrollTimeout = null;
    }, 10);
  }
});

window.addEventListener('beforeunload', () => {
  if (playerInterval) clearInterval(playerInterval);
  if (scrollTimeout) clearTimeout(scrollTimeout);
  if (searchDebounce) clearTimeout(searchDebounce);
  
  domCache.observers.forEach(observer => observer.disconnect());
});

window.NekoFlix = {
  closePlayer,
  showNotification,
  toggleBookmark: (mediaItem, mediaType) => {
    const dummyButton = document.createElement('button');
    toggleBookmark(mediaItem, mediaType, dummyButton);
  }
};

// Mobile menu toggle functionality
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const mobileNavOverlay = document.getElementById('mobile-nav-overlay');
const mainNav = document.querySelector('.main-nav');

if (mobileMenuToggle && mobileNavOverlay && mainNav) {
    // Toggle menu
    mobileMenuToggle.addEventListener('click', () => {
        mainNav.classList.toggle('active');
        mobileNavOverlay.classList.toggle('active');
        
        // Change icon
        const icon = mobileMenuToggle.querySelector('i');
        if (mainNav.classList.contains('active')) {
            icon.className = 'fas fa-times';
        } else {
            icon.className = 'fas fa-bars';
        }
    });
    
    // Close menu when clicking overlay
    mobileNavOverlay.addEventListener('click', () => {
        mainNav.classList.remove('active');
        mobileNavOverlay.classList.remove('active');
        const icon = mobileMenuToggle.querySelector('i');
        icon.className = 'fas fa-bars';
    });
    
    // Close menu when clicking a nav link
    document.querySelectorAll('.main-nav .nav-link').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                mainNav.classList.remove('active');
                mobileNavOverlay.classList.remove('active');
                const icon = mobileMenuToggle.querySelector('i');
                icon.className = 'fas fa-bars';
            }
        });
    });
}

function setupAboutSection() {
  // Subscribe button in About section
  const aboutSubscribeBtn = document.getElementById('about-subscribe-btn');
  if (aboutSubscribeBtn) {
    aboutSubscribeBtn.addEventListener('click', () => {
      openPaymentModal();
    });
  }
  
  // Back to home button
  const backToHomeBtn = document.getElementById('back-to-home');
  if (backToHomeBtn) {
    backToHomeBtn.addEventListener('click', () => {
      // Show header
      const mainHeader = document.getElementById('main-header');
      if (mainHeader) mainHeader.style.display = 'flex';
      document.body.classList.remove('about-page-active');
      
      // Navigate to home
      document.querySelectorAll(".content-section").forEach((s) => s.classList.remove("active"));
      document.getElementById("home-section")?.classList.add("active");
      
      document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
      document.querySelector('[data-section="home"]')?.classList.add("active");
    });
  }
  
  // FAQ Toggle
  setupFAQToggles();
  
  // Scroll animations
  setupScrollAnimations();
}

function setupFAQToggles() {
  const faqItems = document.querySelectorAll('.faq-item');
  
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    
    question.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      
      // Close all other FAQs
      faqItems.forEach(otherItem => {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
        }
      });
      
      // Toggle current FAQ
      if (isActive) {
        item.classList.remove('active');
      } else {
        item.classList.add('active');
      }
    });
  });
}

function setupScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);
  
  // Observe all animated elements in about section
  const animatedElements = document.querySelectorAll(
    '.about-section-block, .feature-card, .comparison-card, .step-card, .source-info-card'
  );
  
  animatedElements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
  });
}


/* ===================================
   HEART ANIMATION STYLES
  =================================== */

async function isSpecialUser(email) {
  try {
    const { data, error } = await supabase
      .from("special_users")
      .select("email, enabled")
      .eq("email", email.toLowerCase())
      .eq("enabled", true)
      .maybeSingle();

    if (error) {
      console.error("Error checking special users:", error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error("Unexpected error checking special users:", error);
    return false;
  }
}

// Heart Animation System
function showHeartAnimation() {
  // Create container
  const container = document.createElement('div');
  container.className = 'heart-animation-container';
  container.innerHTML = `
    <div class="heart-animation-overlay"></div>
    <div class="heart-main-wrapper">
      <div class="heart-main">
        <svg viewBox="0 0 32 29.6" class="heart-svg">
          <path d="M23.6,0c-3.4,0-6.3,2.7-7.6,5.6C14.7,2.7,11.8,0,8.4,0C3.8,0,0,3.8,0,8.4c0,9.4,9.5,11.9,16,21.2
          c6.1-9.3,16-12.1,16-21.2C32,3.8,28.2,0,23.6,0z"/>
        </svg>
      </div>
      <div class="heart-particles"></div>
      <div class="heart-message">Its OUR Webiste!</div>
    </div>
  `;
  
  document.body.appendChild(container);
  
  // Generate particles
  const particlesContainer = container.querySelector('.heart-particles');
  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.className = 'heart-particle';
    
    const angle = (Math.PI * 2 * i) / 30;
    const distance = 100 + Math.random() * 150;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    const delay = Math.random() * 0.3;
    const duration = 1.5 + Math.random() * 0.5;
    
    particle.style.setProperty('--tx', `${tx}px`);
    particle.style.setProperty('--ty', `${ty}px`);
    particle.style.setProperty('--delay', `${delay}s`);
    particle.style.setProperty('--duration', `${duration}s`);
    
    // Random particle type (heart or sparkle)
    if (Math.random() > 0.5) {
      particle.innerHTML = '<svg viewBox="0 0 32 29.6"><path d="M23.6,0c-3.4,0-6.3,2.7-7.6,5.6C14.7,2.7,11.8,0,8.4,0C3.8,0,0,3.8,0,8.4c0,9.4,9.5,11.9,16,21.2c6.1-9.3,16-12.1,16-21.2C32,3.8,28.2,0,23.6,0z"/></svg>';
    } else {
      particle.innerHTML = '<svg viewBox="0 0 512 512"><path d="M256 0l47.4 143.5L448 143.5l-115.9 84.2L377.1 512 256 384.8 134.9 512l45-284.3L64 143.5h144.6z"/></svg>';
    }
    
    particlesContainer.appendChild(particle);
  }
  
  // Trigger animation
  setTimeout(() => {
    container.classList.add('active');
  }, 100);
  
  // Remove after animation
  setTimeout(() => {
    container.classList.add('fadeout');
    setTimeout(() => {
      if (container.parentNode) {
        container.remove();
      }
    }, 800);
  }, 4000);
}

// ===================================
// ENHANCED PROFILE SYSTEM
// ===================================

async function loadUserProfile() {
  if (!currentUser) return;
  
  try {
    // Get or create profile
    let { data: profile, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .single();

    if (error && error.code === 'PGRST116') {
      // Profile doesn't exist, create it
      const { data: newProfile, error: insertError } = await supabase
        .from('user_profiles')
        .insert({
          user_id: currentUser.id,
          display_name: currentUser.email.split('@')[0],
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) throw insertError;
      profile = newProfile;
    } else if (error) {
      throw error;
    }

    // Update consecutive days streak
    await updateLoginStreak(profile);

    // FIRST: Populate the native select with saved data
    const genreSelect = document.getElementById('profile-favorite-genre');
    if (genreSelect && profile.favorite_genre) {
      genreSelect.value = profile.favorite_genre;
    }

    // THEN: Populate other profile UI
    populateProfileUI(profile);
    
    // Load badges and stats
    await loadUserBadges();
    await loadUserStats();
    
  } catch (error) {
    console.error('Error loading user profile:', error);
    showNotification('Failed to load profile data', 'error');
  }
}

function populateProfileUI(profile) {
  // Display name
  const displayNameInput = document.getElementById('profile-display-name');
  if (displayNameInput) {
    displayNameInput.value = profile.display_name || '';
  }
  
  // Favorite genre - just set the native select value
  const genreSelect = document.getElementById('profile-favorite-genre');
  if (genreSelect && profile.favorite_genre) {
    genreSelect.value = profile.favorite_genre;
    genreSelect.setAttribute('data-genre-value', profile.favorite_genre);
  }
  
  // Avatar
  const avatarDisplay = document.getElementById('profile-avatar-display');
  if (avatarDisplay && profile.avatar_url) {
    avatarDisplay.src = profile.avatar_url;
  }
  
  // Update header avatar too
  const headerAvatar = document.querySelector('.user-avatar');
  if (headerAvatar && profile.avatar_url) {
    headerAvatar.src = profile.avatar_url;
  }
  
  // Settings tab
  const settingsEmail = document.getElementById('settings-email');
  if (settingsEmail) {
    settingsEmail.textContent = currentUser.email;
  }
  
  const settingsMemberSince = document.getElementById('settings-member-since');
  if (settingsMemberSince) {
    const date = new Date(profile.created_at);
    settingsMemberSince.textContent = date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }
  
  const settingsStatus = document.getElementById('settings-subscription-status');
  if (settingsStatus) {
    const statusText = isUserApproved ? 'Active' : 'Payment Required';
    const statusClass = isUserApproved ? 'active' : 'pending';
    settingsStatus.textContent = statusText;
    settingsStatus.className = `subscription-status ${statusClass}`;
  }
}

async function loadUserStats() {
  if (!currentUser) return;
  
  try {
    // Get profile stats
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .single();
    
    if (profileError) throw profileError;
    
    // Get bookmark count
    const { count: bookmarkCount, error: bookmarkError } = await supabase
      .from('user_bookmarks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', currentUser.id);
    
    if (bookmarkError) throw bookmarkError;
    
    // Get badge count
    const { count: badgeCount, error: badgeError } = await supabase
      .from('user_badges')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', currentUser.id);
    
    if (badgeError) throw badgeError;
    
    // Update UI
    const watchTimeHours = Math.floor((profile.total_watch_time || 0) / 3600);
    const watchTimeMinutes = Math.floor(((profile.total_watch_time || 0) % 3600) / 60);
    
    document.getElementById('stat-watch-time').textContent = 
      watchTimeHours > 0 ? `${watchTimeHours}h ${watchTimeMinutes}m` : `${watchTimeMinutes}m`;
    document.getElementById('stat-movies').textContent = profile.movies_watched || 0;
    document.getElementById('stat-series').textContent = profile.series_watched || 0;
    document.getElementById('stat-bookmarks').textContent = bookmarkCount || 0;
    document.getElementById('stat-streak').textContent = profile.consecutive_days || 0;
    document.getElementById('stat-badges').textContent = badgeCount || 0;
    
  } catch (error) {
    console.error('Error loading user stats:', error);
  }
}

async function loadUserBadges() {
  if (!currentUser) return;
  
  try {
    // Get all badge definitions
    const { data: allBadges, error: badgesError } = await supabase
      .from('badge_definitions')
      .select('*')
      .order('sort_order');
    
    if (badgesError) throw badgesError;
    
    // Get user's earned badges
    const { data: earnedBadges, error: earnedError } = await supabase
      .from('user_badges')
      .select('*')
      .eq('user_id', currentUser.id);
    
    if (earnedError) throw earnedError;
    
    // Get current stats for progress calculation
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .single();
    
    if (profileError) throw profileError;
    
    const { count: bookmarkCount } = await supabase
      .from('user_bookmarks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', currentUser.id);
    
    // Render badges
    const badgesGrid = document.getElementById('badges-grid');
    if (!badgesGrid) return;
    
    badgesGrid.innerHTML = '';
    
    allBadges.forEach(badge => {
      const earned = earnedBadges.find(eb => eb.badge_type === badge.badge_type);
      const progress = calculateBadgeProgress(badge, profile, bookmarkCount);
      
      const badgeCard = createBadgeCard(badge, earned, progress);
      badgesGrid.appendChild(badgeCard);
    });
    
  } catch (error) {
    console.error('Error loading user badges:', error);
  }
}

function calculateBadgeProgress(badge, profile, bookmarkCount) {
  let current = 0;
  const required = badge.requirement_value;
  
  switch (badge.requirement_type) {
    case 'watch_time':
      current = profile.total_watch_time || 0;
      break;
    case 'movie_count':
      current = profile.movies_watched || 0;
      break;
    case 'series_count':
      current = profile.series_watched || 0;
      break;
    case 'series_complete':
      current = profile.series_completed || 0;
      break;
    case 'night_sessions':
      current = profile.night_sessions || 0;
      break;
    case 'morning_sessions':
      current = profile.morning_sessions || 0;
      break;
    case 'streak_days':
      current = profile.consecutive_days || 0;
      break;
    case 'bookmark_count':
      current = bookmarkCount || 0;
      break;
    case 'watch_count':
      current = (profile.movies_watched || 0) + (profile.series_watched || 0);
      break;
    case 'genre_variety':
      current = profile.genres_watched ? JSON.parse(profile.genres_watched).length : 0;
      break;
    case 'country_variety':
      current = profile.countries_watched ? JSON.parse(profile.countries_watched).length : 0;
      break;
    case 'account_age':
      const accountAge = Math.floor((new Date() - new Date(profile.created_at)) / (1000 * 60 * 60 * 24));
      current = accountAge;
      break;
    default:
      current = 0;
  }
  
  const percentage = Math.min(Math.round((current / required) * 100), 100);
  return { current, required, percentage };
}

function createBadgeCard(badge, earned, progress) {
  const card = document.createElement('div');
  card.className = `badge-card ${earned ? 'earned' : 'locked'}`;
  
  // Set CSS custom properties for badge color
  if (badge.badge_color) {
    card.style.setProperty('--badge-color', badge.badge_color);
    const rgb = hexToRgb(badge.badge_color);
    card.style.setProperty('--badge-color-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  }
  
  const progressBar = earned ? '' : `
    <div class="badge-progress-section">
      <div class="badge-progress-bar">
        <div class="badge-progress-fill" style="width: ${progress.percentage}%"></div>
      </div>
      <div class="badge-progress-text">
        ${formatProgressText(badge.requirement_type, progress.current, progress.required)}
      </div>
    </div>
  `;
  
  const earnedDate = earned ? `
    <div class="badge-earned-date">
      <i class="fas fa-check-circle"></i> Earned ${new Date(earned.earned_at).toLocaleDateString()}
    </div>
  ` : '';
  
  card.innerHTML = `
    <div class="badge-icon-wrapper">
      <i class="${badge.badge_icon || 'fas fa-trophy'}"></i>
    </div>
    <div class="badge-info">
      <div class="badge-name">${badge.badge_name}</div>
      <div class="badge-description">${badge.badge_description}</div>
      ${progressBar}
      ${earnedDate}
    </div>
  `;
  
  return card;
}

function formatProgressText(type, current, required) {
  switch (type) {
    case 'watch_time':
      const currentHours = Math.floor(current / 3600);
      const requiredHours = Math.floor(required / 3600);
      return `${currentHours}h / ${requiredHours}h`;
    case 'movie_count':
    case 'series_count':
    case 'series_complete':
    case 'watch_count':
      return `${current} / ${required}`;
    case 'streak_days':
      return `${current} / ${required} days`;
    case 'bookmark_count':
      return `${current} / ${required} items`;
    case 'night_sessions':
    case 'morning_sessions':
      return `${current} / ${required} sessions`;
    case 'genre_variety':
      return `${current} / ${required} genres`;
    case 'country_variety':
      return `${current} / ${required} countries`;
    case 'account_age':
      return `${current} / ${required} days`;
    default:
      return `${Math.min(Math.round((current / required) * 100), 100)}%`;
  }
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 229, g: 9, b: 20 };
}

async function updateLoginStreak(profile) {
  if (!currentUser) return;
  
  try {
    const today = new Date().toISOString().split('T')[0];
    const lastLogin = profile.last_login_date;
    
    let newStreak = profile.consecutive_days || 0;
    
    if (!lastLogin) {
      newStreak = 1;
    } else {
      const lastDate = new Date(lastLogin);
      const todayDate = new Date(today);
      const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        newStreak = (profile.consecutive_days || 0) + 1;
      } else if (diffDays > 1) {
        newStreak = 1;
      }
    }
    
    if (lastLogin !== today) {
      await supabase
        .from('user_profiles')
        .update({
          consecutive_days: newStreak,
          last_login_date: today
        })
        .eq('user_id', currentUser.id);
      
      // Check for badges after streak update
      await checkAndAwardBadges();
    }
  } catch (error) {
    console.error('Error updating login streak:', error);
  }
}

async function updateWatchTimeStats(mediaType, duration, genreIds = []) {
  if (!currentUser || !duration || duration < 60) return;
  
  try {
    // Get current profile
    const { data: profile, error: fetchError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Calculate session hour
    const currentHour = new Date().getHours();
    const isNightSession = currentHour >= 0 && currentHour < 6;
    const isMorningSession = currentHour >= 5 && currentHour < 8;
    
    // Update counters
    const updates = {
      total_watch_time: (profile.total_watch_time || 0) + Math.floor(duration)
    };
    
    if (mediaType === 'movie') {
      updates.movies_watched = (profile.movies_watched || 0) + 1;
    } else if (mediaType === 'tv') {
      updates.series_watched = (profile.series_watched || 0) + 1;
    }
    
    if (isNightSession) {
      updates.night_sessions = (profile.night_sessions || 0) + 1;
    }
    
    if (isMorningSession) {
      updates.morning_sessions = (profile.morning_sessions || 0) + 1;
    }
    
    // Update genre tracking
    if (genreIds && genreIds.length > 0) {
      const currentGenres = profile.genres_watched ? 
        JSON.parse(profile.genres_watched) : [];
      const updatedGenres = [...new Set([...currentGenres, ...genreIds])];
      updates.genres_watched = JSON.stringify(updatedGenres);
    }
    
    // Update profile
    await supabase
      .from('user_profiles')
      .update(updates)
      .eq('user_id', currentUser.id);
    
    // Record session
    await supabase
      .from('watch_sessions')
      .insert({
        user_id: currentUser.id,
        session_date: new Date().toISOString(),
        session_hour: currentHour,
        watch_duration: Math.floor(duration),
        media_type: mediaType,
        genre_ids: JSON.stringify(genreIds || [])
      });
    
    // Check for new badges
    await checkAndAwardBadges();
    
  } catch (error) {
    console.error('Error updating watch time stats:', error);
  }
}

async function checkAndAwardBadges() {
  if (!currentUser) return;
  
  try {
    const { error } = await supabase.rpc('check_and_award_badges', {
      p_user_id: currentUser.id
    });
    
    if (error) throw error;
    
    // Refresh badges display if modal is open
    if (document.getElementById('account-modal').classList.contains('active')) {
      await loadUserBadges();
      await loadUserStats();
    }
  } catch (error) {
    console.error('Error checking badges:', error);
  }
}

async function saveUserProfile() {
  if (!currentUser) return;
  
  const saveBtn = document.getElementById('save-profile-btn');
  const originalText = saveBtn.innerHTML;
  
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  
  try {
    const displayName = document.getElementById('profile-display-name').value.trim();
    const genreSelect = document.getElementById('profile-favorite-genre');
    const favoriteGenre = genreSelect ? genreSelect.value : null;
    
    if (!displayName) {
      showNotification('Please enter a display name', 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalText;
      return;
    }
    
    // Prepare update object
    const updates = {
      display_name: displayName
    };
    
    // Only include favorite_genre if a value was selected
    if (favoriteGenre) {
      updates.favorite_genre = favoriteGenre;
    }
    
    const { error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('user_id', currentUser.id);
    
    if (error) throw error;
    
    showNotification('Profile saved successfully!', 'success');
    
  } catch (error) {
    console.error('Error saving profile:', error);
    showNotification('Failed to save profile', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalText;
  }
}

async function uploadAvatar(file) {
  if (!currentUser || !file) return;
  
  try {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showNotification('Please upload a PNG, JPG, or WebP image', 'error');
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      showNotification('Image must be less than 5MB', 'error');
      return;
    }
    
    showNotification('Uploading avatar...', 'warning');
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${currentUser.id}/avatar.${fileExt}`;
    
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, file, { upsert: true });
    
    if (uploadError) throw uploadError;
    
    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(fileName);
    
    const avatarUrl = urlData.publicUrl + '?t=' + new Date().getTime();
    
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ avatar_url: avatarUrl })
      .eq('user_id', currentUser.id);
    
    if (updateError) throw updateError;
    
    // Update all avatar instances immediately
    document.getElementById('profile-avatar-display').src = avatarUrl;
    const headerAvatar = document.querySelector('.user-avatar');
    if (headerAvatar) {
      headerAvatar.src = avatarUrl;
      headerAvatar.style.opacity = '0';
      setTimeout(() => {
        headerAvatar.style.transition = 'opacity 0.3s ease';
        headerAvatar.style.opacity = '1';
      }, 50);
    }
    
    showNotification('Avatar updated successfully!', 'success');
    
  } catch (error) {
    console.error('Error uploading avatar:', error);
    showNotification('Failed to upload avatar', 'error');
  }
} 

function setupProfileSystem() {
  // Tab switching
  document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`${targetTab}-tab`).classList.add('active');
    });
  });
  
  // Save profile button
  const saveBtn = document.getElementById('save-profile-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveUserProfile);
  }
  
  // Setup custom genre selector ONLY ONCE when account modal opens
  const accountLink = document.getElementById('account-link');
  if (accountLink) {
    accountLink.addEventListener('click', () => {
      // Small delay to ensure modal is open and data is loaded
      setTimeout(() => {
        const existingSelector = document.querySelector('.custom-genre-selector');
        if (!existingSelector) {
          setupCustomGenreSelector();
        } else {
          // Update existing selector text if genre value exists
          const genreSelect = document.getElementById('profile-favorite-genre');
          if (genreSelect && genreSelect.value) {
            const selectedOption = genreSelect.querySelector(`option[value="${genreSelect.value}"]`);
            if (selectedOption) {
              const triggerText = document.querySelector('.selected-genre-text');
              if (triggerText) {
                triggerText.textContent = selectedOption.textContent;
              }
            }
          }
        }
      }, 100);
    });
  }
  
  // Avatar upload
  const avatarWrapper = document.querySelector('.profile-avatar-wrapper');
  const avatarInput = document.getElementById('avatar-upload-input');
  
  if (avatarWrapper && avatarInput) {
    avatarWrapper.addEventListener('click', () => {
      avatarInput.click();
    });
    
    avatarInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        uploadAvatar(file);
      }
    });
  }
  
  // Change password button
  const changePasswordBtn = document.getElementById('change-password-settings');
  if (changePasswordBtn) {
    changePasswordBtn.addEventListener('click', () => {
      showNotification('Password reset email sent!', 'success');
      supabase.auth.resetPasswordForEmail(currentUser.email);
    });
  }
}


// Custom Genre Selector System
function setupCustomGenreSelector() {
  const genreSelect = document.getElementById('profile-favorite-genre');
  if (!genreSelect) return;
  
  // Store selected value in a global variable for reliability
  let selectedGenreValue = genreSelect.value || '';
  
  // Hide native select
  genreSelect.style.display = 'none';
  
  // Create custom selector
  const customSelector = document.createElement('div');
  customSelector.className = 'custom-genre-selector';
  customSelector.innerHTML = `
    <div class="genre-selector-trigger">
      <span class="selected-genre-text">Select your favorite genre</span>
      <i class="fas fa-chevron-down"></i>
    </div>
  `;
  
  genreSelect.parentNode.insertBefore(customSelector, genreSelect.nextSibling);
  
  // Get genres from select options
  const genres = Array.from(genreSelect.options)
    .filter(opt => opt.value)
    .map(opt => ({ value: opt.value, text: opt.textContent }));
  
  // UPDATED: Set initial text if value exists - THIS IS THE KEY PART
  const triggerText = customSelector.querySelector('.selected-genre-text');
  if (genreSelect.value) {
    selectedGenreValue = genreSelect.value;
    const selectedGenre = genres.find(g => g.value === genreSelect.value);
    if (selectedGenre) {
      triggerText.textContent = selectedGenre.text;
      triggerText.style.color = '#fff'; // Make it visible
    }
  }
  
  // Create floating modal
  const genreModal = document.createElement('div');
  genreModal.className = 'genre-modal';
  genreModal.innerHTML = `
    <div class="genre-modal-overlay"></div>
    <div class="genre-modal-container">
      <div class="genre-modal-header">
        <h3>Choose Your Favorite Genre</h3>
        <button class="genre-modal-close">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="genre-grid">
        ${genres.map(genre => `
          <div class="genre-option" data-value="${genre.value}">
            <div class="genre-icon">
              <i class="${getGenreIcon(genre.value)}"></i>
            </div>
            <span class="genre-name">${genre.text}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  document.body.appendChild(genreModal);
  
  // Open modal
  customSelector.querySelector('.genre-selector-trigger').addEventListener('click', () => {
    genreModal.classList.add('active');
    setTimeout(() => genreModal.classList.add('show'), 50);
  });
  
  // Close modal
  const closeModal = () => {
    genreModal.classList.remove('show');
    setTimeout(() => genreModal.classList.remove('active'), 300);
  };
  
  genreModal.querySelector('.genre-modal-close').addEventListener('click', closeModal);
  genreModal.querySelector('.genre-modal-overlay').addEventListener('click', closeModal);
  
  // Select genre with animation
  genreModal.querySelectorAll('.genre-option').forEach(option => {
    option.addEventListener('click', () => {
      const value = option.dataset.value;
      const text = option.querySelector('.genre-name').textContent;
      
      // IMMEDIATELY update the global variable
      selectedGenreValue = value;
      
      // Remove active from all
      genreModal.querySelectorAll('.genre-option').forEach(opt => {
        if (opt !== option) {
          opt.classList.add('disappear');
        }
      });
      
      // Animate selected
      option.classList.add('selected');
      
      setTimeout(() => {
        // Update native select
        genreSelect.value = value;
        genreSelect.setAttribute('data-genre-value', value);
        
        // Update trigger text
        triggerText.textContent = text;
        triggerText.style.color = '#fff';
        
        // Close modal
        closeModal();
        
        // Reset for next time
        setTimeout(() => {
          genreModal.querySelectorAll('.genre-option').forEach(opt => {
            opt.classList.remove('disappear', 'selected');
          });
        }, 300);
      }, 600);
    });
  });
  
  // Expose getter function
  window.getSelectedGenre = () => selectedGenreValue;
}

function getGenreIcon(genre) {
  const icons = {
    'action': 'fas fa-fist-raised',
    'comedy': 'fas fa-laugh',
    'drama': 'fas fa-theater-masks',
    'horror': 'fas fa-ghost',
    'sci-fi': 'fas fa-rocket',
    'thriller': 'fas fa-user-secret',
    'romance': 'fas fa-heart',
    'documentary': 'fas fa-film',
    'animation': 'fas fa-palette'
  };
  return icons[genre] || 'fas fa-star';
}