// ============================================
// VCF Dashboard V2.0 - Main Application
// ============================================

// Configuration
const SUPABASE_URL = "https://vzzxdwvebxckjtuezwzo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6enhkd3ZlYnhja2p0dWV6d3pvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyNDMyODAsImV4cCI6MjA4MzgxOTI4MH0.kyfCzC-AAdTezTJ6VZV8DndFP8MDh8gIRCPzM_V8vbQ";
const FINNHUB_KEY = "d5jgi69r01qgsosg5790d5jgi69r01qgsosg579g";

// Initialize Supabase client
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Root container
const app = document.getElementById("app");

// ============================================
// APP STATE
// ============================================
const AppState = {
  user: null,
  account: null,
  role: 'investor', // investor | member | admin
  currentTab: 'overview',

  // Data cache
  accounts: [],
  holdings: [],
  meetings: [],
  pitches: [],
  votes: [],
  resources: [],
  benchmarkData: [],

  // Enriched data
  enrichedHoldings: [],
  fundValue: 0,
  prevFundValue: 0,
  totalUnits: 0,
  nav: 0,
  myBalance: 0,

  // Price cache
  priceCache: null,
  lastPriceFetch: 0,

  // Charts
  sectorChart: null,
  benchmarkChart: null,

  // Chat
  channels: [],
  currentChannelId: null,
  chatMessages: {},  // { channelId: [messages] }
  chatSubscription: null
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Generate initials from name
function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// Generate consistent color from string
function stringToColor(str) {
  if (!str) return '#002952';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 50%, 45%)`;
}

// Format date
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format currency
function formatCurrency(amount) {
  const num = Number(amount);
  if (isNaN(num)) return '$0.00';
  return '$' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Format percentage
function formatPercent(value, decimals = 2) {
  const num = Number(value);
  if (isNaN(num)) return '0.00%';
  return (num * 100).toFixed(decimals) + '%';
}

// Check voting eligibility (balance >= $300 OR units >= 290)
function isVotingEligible(account, nav) {
  if (!account) return false;
  const units = Number(account.units) || 0;
  const balance = units * (Number(nav) || 0);
  return balance >= 300 || units >= 290;
}

// ============================================
// API FUNCTIONS
// ============================================

async function fetchPrices(symbols) {
  const now = Date.now();
  const CACHE_KEY = 'vcf_price_cache';
  const CACHE_TIME_KEY = 'vcf_price_cache_time';

  // Try to load from localStorage first
  if (!AppState.priceCache) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
      if (cached && cachedTime) {
        AppState.priceCache = JSON.parse(cached);
        AppState.lastPriceFetch = parseInt(cachedTime);
      }
    } catch (e) {
      console.warn('Could not load price cache from localStorage');
    }
  }

  // Reuse prices for 5 minutes to avoid rate limiting
  if (AppState.priceCache && now - AppState.lastPriceFetch < 300_000) {
    console.log('Using cached prices (age: ' + Math.round((now - AppState.lastPriceFetch) / 1000) + 's)');
    return AppState.priceCache;
  }

  console.log('Fetching fresh prices for:', symbols);

  // Start with cached prices as fallback
  const results = { ...(AppState.priceCache || {}) };

  // Fetch all prices in parallel to beat rate limit
  const fetchPromises = symbols.map(async (sym) => {
    if (sym === "CASH") {
      return { sym, price: 1, prevClose: 1 };
    }

    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`
      );

      if (!res.ok) {
        console.warn(`API error for ${sym}: ${res.status}`);
        return { sym, price: null, prevClose: null };
      }

      const data = await res.json();

      if (data && typeof data.c === 'number' && data.c > 0) {
        console.log(`${sym}: $${data.c} (prev: $${data.pc})`);
        return { sym, price: data.c, prevClose: data.pc || data.c };
      } else {
        console.warn(`Invalid price data for ${sym}:`, data);
        return { sym, price: null, prevClose: null };
      }
    } catch (e) {
      console.error(`Error fetching price for ${sym}:`, e);
      return { sym, price: null, prevClose: null };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);

  // Merge results - only update if we got valid data
  for (const { sym, price, prevClose } of fetchResults) {
    if (price !== null && price > 0) {
      results[sym] = { price, prevClose };
    } else if (!results[sym]) {
      // No cached data and no new data
      results[sym] = { price: 0, prevClose: 0 };
    }
    // else: keep existing cached price
  }

  AppState.priceCache = results;
  AppState.lastPriceFetch = now;

  // Save to localStorage for persistence across refreshes
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(results));
    localStorage.setItem(CACHE_TIME_KEY, now.toString());
  } catch (e) {
    console.warn('Could not save price cache to localStorage');
  }

  return results;
}

async function loadAllData() {
  const [
    { data: accounts },
    { data: holdings },
    { data: meetings },
    { data: pitches },
    { data: votes },
    { data: resources },
    { data: benchmarkData },
    { data: channels }
  ] = await Promise.all([
    supa.from("accounts").select("*"),
    supa.from("holdings").select("*"),
    supa.from("meetings").select("*").order('date', { ascending: false }),
    supa.from("pitches").select("*").order('pitch_date', { ascending: false }),
    supa.from("votes").select("*"),
    supa.from("resources").select("*").order('category'),
    supa.from("benchmark_data").select("*").order('date'),
    supa.from("channels").select("*").order('created_at')
  ]);

  AppState.accounts = accounts || [];
  AppState.holdings = holdings || [];
  AppState.meetings = meetings || [];
  AppState.pitches = pitches || [];
  AppState.votes = votes || [];
  AppState.resources = resources || [];
  AppState.benchmarkData = benchmarkData || [];
  AppState.channels = channels || [];

  // Enrich holdings with prices
  const symbols = [...new Set(AppState.holdings.map(h => h.symbol))];
  const prices = await fetchPrices(symbols);

  AppState.enrichedHoldings = AppState.holdings.map(h => {
    const priceObj = prices[h.symbol] ?? { price: 0, prevClose: 0 };
    const price = Number(priceObj.price) || 0;
    // If prevClose is 0 or invalid, use current price (results in 0% day change for that holding)
    const prevClose = Number(priceObj.prevClose) > 0 ? Number(priceObj.prevClose) : price;
    const shares = Number(h.shares) || 0;
    const costBasis = Number(h.cost_basis) || 0;

    const marketValue = shares * price;
    const prevValue = shares * prevClose;
    const costValue = shares * costBasis;
    const pnl = marketValue - costValue;

    console.log(`${h.symbol}: price=${price}, prevClose=${prevClose}, shares=${shares}, marketValue=${marketValue}, prevValue=${prevValue}`);

    return {
      ...h,
      shares,
      cost_basis: costBasis,
      price,
      marketValue: isNaN(marketValue) ? 0 : marketValue,
      costValue: isNaN(costValue) ? 0 : costValue,
      pnl: isNaN(pnl) ? 0 : pnl,
      prevClose,
      prevValue: isNaN(prevValue) ? 0 : prevValue
    };
  });

  // Calculate fund metrics
  AppState.fundValue = AppState.enrichedHoldings.reduce((s, h) => s + (h.marketValue || 0), 0);
  AppState.prevFundValue = AppState.enrichedHoldings.reduce((s, h) => s + (h.prevValue || 0), 0);
  AppState.totalUnits = AppState.accounts.reduce((s, a) => s + (Number(a.units) || 0), 0);
  AppState.nav = AppState.totalUnits > 0 ? AppState.fundValue / AppState.totalUnits : 0;
  AppState.myBalance = AppState.account ? (Number(AppState.account.units) || 0) * AppState.nav : 0;

  const dayPL = AppState.prevFundValue > 0 ? ((AppState.fundValue - AppState.prevFundValue) / AppState.prevFundValue * 100) : 0;
  console.log(`Fund: value=${AppState.fundValue.toFixed(2)}, prevValue=${AppState.prevFundValue.toFixed(2)}, dayPL=${dayPL.toFixed(2)}%`);
}

// ============================================
// ROUTER
// ============================================

function getTabFromHash() {
  const hash = window.location.hash.slice(1) || 'overview';
  return hash;
}

function navigateTo(tab) {
  window.location.hash = tab;
}

function handleRouteChange() {
  const tab = getTabFromHash();
  AppState.currentTab = tab;
  renderCurrentTab();
  updateActiveNav();
}

function updateActiveNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === '#' + AppState.currentTab) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

// ============================================
// AUTH FUNCTIONS
// ============================================

async function checkSession() {
  const { data: { session } } = await supa.auth.getSession();

  if (!session) {
    renderLogin();
    return false;
  }

  AppState.user = session.user;
  return true;
}

async function handleLogin(email, password) {
  const { error } = await supa.auth.signInWithPassword({ email, password });
  return error;
}

async function handleSignUp(email, password) {
  const { error } = await supa.auth.signUp({ email, password });
  return error;
}

async function handleForgotPassword(email) {
  const { error } = await supa.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });
  return error;
}

async function handleLogout() {
  await supa.auth.signOut();
  AppState.user = null;
  AppState.account = null;
  AppState.role = 'investor';
  init();
}

// ============================================
// RENDER: LOGIN
// ============================================

function renderLogin(mode = "login") {
  const isCreate = mode === "create";

  app.innerHTML = `
    <div class="login-wrapper d-flex align-items-center justify-content-center min-vh-100">
      <div class="login-card card shadow-lg" style="width: 380px;">
        <div class="card-body p-4">
          <h2 class="text-vcf-primary mb-1">Varsity Capital</h2>
          <p class="text-muted mb-4">
            ${isCreate ? "Create your account" : "Sign in to your dashboard"}
          </p>

          <div id="loginMsg" class="alert d-none mb-3" role="alert"></div>

          <div class="mb-3">
            <input type="email" class="form-control" id="email" placeholder="Email" />
          </div>
          <div class="mb-3">
            <input type="password" class="form-control" id="password" placeholder="Password" />
          </div>

          ${isCreate ? `
            <div class="mb-3">
              <input type="password" class="form-control" id="password2" placeholder="Confirm password" />
            </div>
          ` : ""}

          <button class="btn btn-vcf-primary w-100 mb-3" id="primaryBtn">
            ${isCreate ? "Create account" : "Login"}
          </button>

          ${isCreate ? `
            <button class="btn btn-link p-0 text-vcf-primary" id="backBtn">
              Already have an account?
            </button>
          ` : `
            <div class="d-flex justify-content-between">
              <button class="btn btn-link p-0 text-vcf-primary" id="forgotBtn">
                Forgot password
              </button>
              <button class="btn btn-link p-0 text-vcf-primary" id="createBtn">
                Create account
              </button>
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  const showMsg = (text, type = "info") => {
    const el = document.getElementById("loginMsg");
    el.textContent = text;
    el.className = `alert alert-${type === 'error' ? 'danger' : type} mb-3`;
  };

  const getEmail = () => document.getElementById("email").value;
  const getPass = () => document.getElementById("password").value;

  if (isCreate) {
    document.getElementById("primaryBtn").onclick = async () => {
      const p1 = getPass();
      const p2 = document.getElementById("password2").value;

      if (p1 !== p2) {
        showMsg("Passwords do not match.", "error");
        return;
      }

      const error = await handleSignUp(getEmail(), p1);
      if (error) showMsg(error.message, "error");
      else showMsg("Account created. Check your email for confirmation.", "success");
    };

    document.getElementById("backBtn").onclick = () => renderLogin("login");
  } else {
    document.getElementById("primaryBtn").onclick = async () => {
      const error = await handleLogin(getEmail(), getPass());
      if (error) showMsg(error.message, "error");
      else init();
    };

    document.getElementById("forgotBtn").onclick = async () => {
      const e = getEmail();
      if (!e) {
        showMsg("Enter your email first.", "error");
        return;
      }

      const error = await handleForgotPassword(e);
      if (error) showMsg(error.message, "error");
      else showMsg("Password reset email sent.", "success");
    };

    document.getElementById("createBtn").onclick = () => renderLogin("create");
  }
}

// ============================================
// RENDER: LOADING
// ============================================

function renderLoading() {
  app.innerHTML = `
    <div class="loading-screen d-flex align-items-center justify-content-center min-vh-100">
      <div class="d-flex flex-column align-items-center">
        <div class="spinner mx-auto mb-3"></div>
        <div class="text-muted">Loading fund data...</div>
      </div>
    </div>
  `;
}

// ============================================
// RENDER: NO ACCOUNT
// ============================================

function renderNoAccount() {
  app.innerHTML = `
    <div class="login-wrapper d-flex align-items-center justify-content-center min-vh-100">
      <div class="card shadow-lg" style="width: 400px;">
        <div class="card-body p-4 text-center">
          <h2 class="text-vcf-primary mb-2">Account Not Linked</h2>
          <p class="text-muted mb-3">
            Your login exists, but you have not been assigned an account yet.
          </p>
          <p class="small text-muted mb-4">
            Please contact the fund administrator.
          </p>
          <button class="btn btn-vcf-primary" id="logoutBtn">Sign out</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("logoutBtn").onclick = handleLogout;
}

// ============================================
// RENDER: MAIN LAYOUT
// ============================================

function renderLayout() {
  const role = AppState.role;
  const isAdmin = role === 'admin';
  const isMember = role === 'member' || isAdmin;

  const navItems = getNavItems(role, isAdmin);

  app.innerHTML = `
    <!-- Mobile Header -->
    <nav class="navbar navbar-dark bg-vcf-primary d-lg-none fixed-top">
      <div class="container-fluid">
        <span class="navbar-brand mb-0 h1">Varsity Capital</span>
        <button class="navbar-toggler" type="button" data-bs-toggle="offcanvas" data-bs-target="#mobileSidebar">
          <span class="navbar-toggler-icon"></span>
        </button>
      </div>
    </nav>

    <!-- Mobile Offcanvas Sidebar -->
    <div class="offcanvas offcanvas-start bg-vcf-primary" tabindex="-1" id="mobileSidebar">
      <div class="offcanvas-header border-bottom border-light border-opacity-25">
        <h5 class="offcanvas-title text-white">Varsity Capital</h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas"></button>
      </div>
      <div class="offcanvas-body d-flex flex-column p-0">
        <nav class="nav flex-column py-2">
          ${navItems}
        </nav>
        ${renderSidebarFooter()}
      </div>
    </div>

    <!-- Desktop Layout -->
    <div class="d-flex">
      <!-- Desktop Sidebar -->
      <aside class="sidebar d-none d-lg-flex flex-column">
        <div class="sidebar-header p-3 border-bottom border-light border-opacity-25">
          <h5 class="text-white mb-0">Varsity Capital</h5>
        </div>
        <nav class="nav flex-column py-2 flex-grow-1">
          ${navItems}
        </nav>
        ${renderSidebarFooter()}
      </aside>

      <!-- Main Content -->
      <main class="main-content" id="main">
        <!-- Content rendered here -->
      </main>
    </div>
  `;

  // Setup event listeners
  setupNavListeners();

  // Render current tab
  handleRouteChange();
}

function getNavItems(role, showAdminTabs) {
  const isAdmin = role === 'admin';
  const isMember = role === 'member' || isAdmin;

  let items = '';

  // Overview - all roles
  items += navItem('overview', 'speedometer2', 'Overview');

  if (isMember) {
    items += navItem('analytics', 'graph-up', 'Analytics');
    items += navItem('meetings', 'calendar-event', 'Meeting History');
    items += navItem('pitches', 'lightbulb', 'Stock Pitches');
    items += navItem('chat', 'chat-dots', 'Chat');
    items += navItem('resources', 'book', 'Educational Resources');
    items += navItem('account', 'person-circle', 'Account Management');
  } else {
    // Investor - disabled items
    items += navItemDisabled('Performance');
    items += navItemDisabled('Holdings');
    items += navItemDisabled('Fund Structure');
    items += navItemDisabled('Your Account');
  }

  if (showAdminTabs) {
    items += `<div class="nav-divider my-2 mx-3 border-top border-light border-opacity-25"></div>`;
    items += navItem('votes', 'check2-square', 'Vote Management');
    items += navItem('data-tools', 'database', 'Data Tools');
  }

  return items;
}

function navItem(hash, icon, label) {
  const active = AppState.currentTab === hash ? 'active' : '';
  return `
    <a href="#${hash}" class="nav-link text-white-75 px-3 py-2 mx-2 rounded ${active}" data-bs-dismiss="offcanvas">
      <i class="bi bi-${icon} me-2"></i>${label}
    </a>
  `;
}

function navItemDisabled(label) {
  return `
    <span class="nav-link text-white-50 px-3 py-2 mx-2 disabled">
      ${label} <span class="badge bg-light bg-opacity-25 ms-2">Soon</span>
    </span>
  `;
}

function renderSidebarFooter() {
  const name = AppState.account?.name || 'User';
  const profilePic = renderProfilePicture(AppState.account, 'sm');

  return `
    <div class="sidebar-footer mt-auto p-3 border-top border-light border-opacity-25">
      <div class="d-flex align-items-center mb-3">
        ${profilePic}
        <span class="text-white ms-2 small">${name}</span>
      </div>
      <button class="btn btn-sm btn-outline-light w-100" id="logoutBtnSidebar">
        <i class="bi bi-box-arrow-left me-1"></i>Sign out
      </button>
    </div>
  `;
}

function renderProfilePicture(account, size = 'md') {
  const sizeClass = size === 'sm' ? 'profile-pic-sm' : size === 'lg' ? 'profile-pic-lg' : 'profile-pic-md';
  const sizePx = size === 'sm' ? 32 : size === 'lg' ? 80 : 48;

  if (account?.profile_picture_url) {
    return `<img src="${account.profile_picture_url}" class="rounded-circle ${sizeClass}" width="${sizePx}" height="${sizePx}" alt="Profile" />`;
  }

  const initials = getInitials(account?.name);

  return `
    <div class="rounded-circle d-flex align-items-center justify-content-center text-white ${sizeClass}"
         style="width: ${sizePx}px; height: ${sizePx}px; background: #6b7280; font-size: ${sizePx * 0.4}px;">
      ${initials}
    </div>
  `;
}

function setupNavListeners() {
  // Logout buttons
  document.querySelectorAll('#logoutBtnSidebar').forEach(btn => {
    btn.onclick = handleLogout;
  });

  // Nav link click handlers
  document.querySelectorAll('.nav-link[href^="#"]').forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      const hash = link.getAttribute('href');
      if (hash && hash !== '#') {
        window.location.hash = hash;
        handleRouteChange();
      }
    };
  });
}


// ============================================
// RENDER: TAB CONTENT
// ============================================

function renderCurrentTab() {
  const main = document.getElementById('main');
  if (!main) return;

  const tab = AppState.currentTab;
  const role = AppState.role;
  const isMember = role === 'member' || role === 'admin';
  const isAdmin = role === 'admin';

  // Clean up chat subscription when leaving chat tab
  if (AppState.chatSubscription && tab !== 'chat') {
    supa.removeChannel(AppState.chatSubscription);
    AppState.chatSubscription = null;
  }

  // Check permissions
  const memberTabs = ['analytics', 'meetings', 'pitches', 'chat', 'resources', 'account'];
  const adminTabs = ['votes', 'data-tools'];

  if (memberTabs.includes(tab) && !isMember) {
    main.innerHTML = renderAccessDenied();
    return;
  }

  if (adminTabs.includes(tab) && !isAdmin) {
    main.innerHTML = renderAccessDenied();
    return;
  }

  switch (tab) {
    case 'overview':
      renderOverviewTab(main);
      break;
    case 'analytics':
      renderAnalyticsTab(main);
      break;
    case 'meetings':
      renderMeetingsTab(main);
      break;
    case 'pitches':
      renderPitchesTab(main);
      break;
    case 'chat':
      renderChatTab(main);
      break;
    case 'resources':
      renderResourcesTab(main);
      break;
    case 'account':
      renderAccountTab(main);
      break;
    case 'votes':
      renderVoteManagement(main);
      break;
    case 'data-tools':
      renderDataTools(main);
      break;
    default:
      renderOverviewTab(main);
  }
}

function renderAccessDenied() {
  return `
    <div class="container py-5">
      <div class="alert alert-warning">
        <i class="bi bi-lock me-2"></i>
        You don't have permission to access this page.
      </div>
    </div>
  `;
}

// ============================================
// TAB: OVERVIEW
// ============================================

function renderOverviewTab(main) {
  const { account, fundValue, prevFundValue, totalUnits, nav, myBalance, enrichedHoldings, accounts } = AppState;

  const dayPLDollar = fundValue - prevFundValue;
  const dayPLPct = prevFundValue > 0 ? (fundValue - prevFundValue) / prevFundValue : 0;

  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="row g-4">
        <!-- Your Account Card -->
        <div class="col-lg-6 col-xl-4">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title mb-3">Your Account</h5>
              <div class="d-flex align-items-center mb-3">
                ${renderProfilePicture(account, 'lg')}
                <div class="ms-3">
                  <h6 class="mb-0">${account?.name || 'User'}</h6>
                </div>
              </div>
              <div class="row text-center border-top pt-3">
                <div class="col">
                  <div class="text-muted small">Units</div>
                  <div class="fw-semibold">${Number(account?.units || 0).toFixed(2)}</div>
                </div>
                <div class="col">
                  <div class="text-muted small">Balance</div>
                  <div class="fw-semibold">${formatCurrency(myBalance)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Fund Summary Card -->
        <div class="col-lg-6 col-xl-4">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title mb-3">Fund Summary</h5>
              <div class="mb-2 d-flex justify-content-between">
                <span class="text-muted">Total Value</span>
                <span class="fw-semibold">${formatCurrency(fundValue)}</span>
              </div>
              <div class="mb-2 d-flex justify-content-between">
                <span class="text-muted">Total Units</span>
                <span class="fw-semibold">${(totalUnits || 0).toFixed(2)}</span>
              </div>
              <div class="mb-2 d-flex justify-content-between">
                <span class="text-muted">NAV per Unit</span>
                <span class="fw-semibold">${formatCurrency(nav)}</span>
              </div>
              <div class="d-flex justify-content-between border-top pt-2 mt-2">
                <span class="text-muted">Day P/L</span>
                <span class="fw-semibold ${dayPLPct >= 0 ? 'text-success' : 'text-danger'}">
                  ${dayPLPct >= 0 ? '+' : ''}${formatPercent(dayPLPct)} (${dayPLPct >= 0 ? '+' : ''}${formatCurrency(dayPLDollar)})
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Sector Allocation Chart -->
        <div class="col-lg-12 col-xl-4">
          <div class="card h-100">
            <div class="card-body">
              <h5 class="card-title mb-3">Sector Allocation</h5>
              <div class="chart-container" style="position: relative; height: 320px;">
                <canvas id="sectorChart"></canvas>
              </div>
            </div>
          </div>
        </div>

        <!-- Holdings Table -->
        <div class="col-12">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title mb-3">Holdings</h5>
              <div class="table-responsive">
                <table class="table table-hover">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Sector</th>
                      <th class="text-end">Shares</th>
                      <th class="text-end">Cost Basis</th>
                      <th class="text-end">Price</th>
                      <th class="text-end">Value</th>
                      <th class="text-end">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${enrichedHoldings.map(h => `
                      <tr>
                        <td><strong>${h.symbol}</strong></td>
                        <td><span class="badge bg-light text-dark">${h.sector || '-'}</span></td>
                        <td class="text-end">${h.shares}</td>
                        <td class="text-end">${formatCurrency(h.cost_basis)}</td>
                        <td class="text-end">${formatCurrency(h.price)}</td>
                        <td class="text-end">${formatCurrency(h.marketValue)}</td>
                        <td class="text-end ${h.pnl >= 0 ? 'text-success' : 'text-danger'}">
                          ${h.pnl >= 0 ? '+' : ''}${formatCurrency(h.pnl)}
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- Accounts Table -->
        <div class="col-12">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title mb-3">Fund Participants</h5>
              <div class="table-responsive">
                <table class="table table-hover">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th class="text-end">Units</th>
                      <th class="text-end">Balance</th>
                      <th class="text-end">% of Fund</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${renderAccountsTable()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render sector chart
  renderSectorChart();
}

function renderAccountsTable() {
  const { accounts, nav, fundValue, role, account: myAccount } = AppState;
  const isAdmin = role === 'admin';

  const accountsWithBalances = accounts.map(a => {
    const units = Number(a.units) || 0;
    const balance = units * (nav || 0);
    const pct = fundValue > 0 ? balance / fundValue : 0;
    return { ...a, units, balance: isNaN(balance) ? 0 : balance, pct: isNaN(pct) ? 0 : pct };
  }).sort((a, b) => b.balance - a.balance);

  return accountsWithBalances.map((a, i) => {
    const label = isAdmin ? a.name : `Account ${String.fromCharCode(65 + i)}`;
    const isMe = a.owner_user_id === myAccount?.owner_user_id;

    return `
      <tr class="${isMe ? 'table-active' : ''}">
        <td>
          ${isAdmin ? renderProfilePicture(a, 'sm') : ''}
          <span class="${isAdmin ? 'ms-2' : ''}">${label}</span>
          ${isMe ? '<span class="badge bg-primary ms-2">You</span>' : ''}
        </td>
        <td class="text-end">${(Number(a.units) || 0).toFixed(2)}</td>
        <td class="text-end">${formatCurrency(a.balance)}</td>
        <td class="text-end">${formatPercent(a.pct)}</td>
      </tr>
    `;
  }).join('');
}

function renderSectorChart() {
  const { enrichedHoldings } = AppState;

  const sectorTotals = {};
  for (const h of enrichedHoldings) {
    const sector = h.sector || 'Other';
    const value = Number(h.marketValue) || 0;
    if (value > 0) {
      sectorTotals[sector] = (sectorTotals[sector] || 0) + value;
    }
  }

  const labels = Object.keys(sectorTotals);
  const values = Object.values(sectorTotals);

  const ctx = document.getElementById('sectorChart');
  if (!ctx) return;

  // Don't render if no valid data
  if (labels.length === 0 || values.every(v => v === 0)) {
    ctx.parentElement.innerHTML = '<p class="text-muted text-center">No sector data available</p>';
    return;
  }

  if (AppState.sectorChart) {
    AppState.sectorChart.destroy();
    AppState.sectorChart = null;
  }

  AppState.sectorChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: [
          '#002952', '#1f4e79', '#4a90e2', '#7fb3ff', '#cfe3ff', '#9bbad9',
          '#003d7a', '#2a5f8f', '#5c9ce6', '#8fc4ff'
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const value = context.raw;
              const pct = (value / total) * 100;
              return `${context.label}: ${formatCurrency(value)} (${pct.toFixed(1)}%)`;
            }
          }
        }
      }
    }
  });
}

// ============================================
// TAB: ANALYTICS
// ============================================

function renderAnalyticsTab(main) {
  const { enrichedHoldings, fundValue, prevFundValue, benchmarkData } = AppState;

  // Calculate metrics
  const totalCost = enrichedHoldings.reduce((s, h) => s + h.costValue, 0);
  const totalPnL = fundValue - totalCost;
  const totalReturn = totalCost > 0 ? totalPnL / totalCost : 0;
  const dayChange = fundValue - prevFundValue;
  const dayPct = prevFundValue > 0 ? dayChange / prevFundValue : 0;

  // Top performers
  const topPerformers = [...enrichedHoldings]
    .filter(h => h.symbol !== 'CASH')
    .sort((a, b) => (b.pnl / b.costValue) - (a.pnl / a.costValue))
    .slice(0, 5);

  main.innerHTML = `
    <div class="container-fluid py-4">
      <h4 class="mb-4">Analytics</h4>

      <div class="row g-4">
        <!-- Performance Metrics -->
        <div class="col-md-6 col-xl-3">
          <div class="card bg-vcf-primary text-white h-100">
            <div class="card-body">
              <h6 class="text-white-50 mb-2">Total Fund Value</h6>
              <h3>${formatCurrency(fundValue)}</h3>
            </div>
          </div>
        </div>
        <div class="col-md-6 col-xl-3">
          <div class="card h-100">
            <div class="card-body">
              <h6 class="text-muted mb-2">Total P/L</h6>
              <h3 class="${totalPnL >= 0 ? 'text-success' : 'text-danger'}">
                ${totalPnL >= 0 ? '+' : ''}${formatCurrency(totalPnL)}
              </h3>
              <small class="${totalReturn >= 0 ? 'text-success' : 'text-danger'}">
                ${totalReturn >= 0 ? '+' : ''}${formatPercent(totalReturn)}
              </small>
            </div>
          </div>
        </div>
        <div class="col-md-6 col-xl-3">
          <div class="card h-100">
            <div class="card-body">
              <h6 class="text-muted mb-2">Day Change</h6>
              <h3 class="${dayChange >= 0 ? 'text-success' : 'text-danger'}">
                ${dayChange >= 0 ? '+' : ''}${formatCurrency(dayChange)}
              </h3>
              <small class="${dayPct >= 0 ? 'text-success' : 'text-danger'}">
                ${dayPct >= 0 ? '+' : ''}${formatPercent(dayPct)}
              </small>
            </div>
          </div>
        </div>
        <div class="col-md-6 col-xl-3">
          <div class="card h-100">
            <div class="card-body">
              <h6 class="text-muted mb-2">Positions</h6>
              <h3>${enrichedHoldings.length}</h3>
              <small class="text-muted">${enrichedHoldings.filter(h => h.symbol !== 'CASH').length} stocks + cash</small>
            </div>
          </div>
        </div>

        <!-- Top Performers -->
        <div class="col-lg-6">
          <div class="card h-100">
            <div class="card-body">
              <h5 class="card-title mb-3">Top Performers</h5>
              ${topPerformers.map(h => {
                const returnPct = h.costValue > 0 ? h.pnl / h.costValue : 0;
                return `
                  <div class="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <strong>${h.symbol}</strong>
                      <div class="small text-muted">${h.sector || '-'}</div>
                    </div>
                    <div class="text-end">
                      <div class="${returnPct >= 0 ? 'text-success' : 'text-danger'} fw-semibold">
                        ${returnPct >= 0 ? '+' : ''}${formatPercent(returnPct)}
                      </div>
                      <div class="small ${h.pnl >= 0 ? 'text-success' : 'text-danger'}">
                        ${h.pnl >= 0 ? '+' : ''}${formatCurrency(h.pnl)}
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <!-- Benchmark Chart -->
        <div class="col-lg-6">
          <div class="card h-100">
            <div class="card-body">
              <h5 class="card-title mb-3">Fund vs S&P 500</h5>
              ${benchmarkData.length > 0 ? `
                <div class="chart-container" style="position: relative; height: 250px;">
                  <canvas id="benchmarkChart"></canvas>
                </div>
              ` : `
                <div class="text-muted text-center py-5">
                  <i class="bi bi-graph-up fs-1 mb-2 d-block"></i>
                  No benchmark data available yet.
                </div>
              `}
            </div>
          </div>
        </div>

        <!-- Position Details -->
        <div class="col-12">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title mb-3">Position Details</h5>
              <div class="table-responsive">
                <table class="table table-hover">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Sector</th>
                      <th class="text-end">Shares</th>
                      <th class="text-end">Avg Cost</th>
                      <th class="text-end">Current</th>
                      <th class="text-end">Cost Basis</th>
                      <th class="text-end">Market Value</th>
                      <th class="text-end">Return %</th>
                      <th class="text-end">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${enrichedHoldings.map(h => {
                      const returnPct = h.costValue > 0 ? h.pnl / h.costValue : 0;
                      const weight = fundValue > 0 ? h.marketValue / fundValue : 0;
                      return `
                        <tr>
                          <td><strong>${h.symbol}</strong></td>
                          <td><span class="badge bg-light text-dark">${h.sector || '-'}</span></td>
                          <td class="text-end">${h.shares}</td>
                          <td class="text-end">${formatCurrency(h.cost_basis)}</td>
                          <td class="text-end">${formatCurrency(h.price)}</td>
                          <td class="text-end">${formatCurrency(h.costValue)}</td>
                          <td class="text-end">${formatCurrency(h.marketValue)}</td>
                          <td class="text-end ${returnPct >= 0 ? 'text-success' : 'text-danger'}">
                            ${returnPct >= 0 ? '+' : ''}${formatPercent(returnPct)}
                          </td>
                          <td class="text-end">${formatPercent(weight)}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render benchmark chart if data exists
  if (benchmarkData.length > 0) {
    renderBenchmarkChart();
  }
}

function renderBenchmarkChart() {
  const { benchmarkData } = AppState;

  const ctx = document.getElementById('benchmarkChart');
  if (!ctx || benchmarkData.length === 0) return;

  if (AppState.benchmarkChart) {
    AppState.benchmarkChart.destroy();
  }

  // Normalize to 100 at start
  const firstSP = benchmarkData[0]?.sp500_close || 1;
  const firstNAV = benchmarkData[0]?.fund_nav || 1;

  const labels = benchmarkData.map(d => formatDate(d.date));
  const spData = benchmarkData.map(d => (d.sp500_close / firstSP) * 100);
  const fundData = benchmarkData.map(d => (d.fund_nav / firstNAV) * 100);

  AppState.benchmarkChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Fund NAV',
          data: fundData,
          borderColor: '#002952',
          backgroundColor: 'rgba(0, 41, 82, 0.1)',
          fill: true,
          tension: 0.3
        },
        {
          label: 'S&P 500',
          data: spData,
          borderColor: '#9bbad9',
          backgroundColor: 'transparent',
          borderDash: [5, 5],
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      },
      scales: {
        y: {
          title: { display: true, text: 'Indexed (Start = 100)' }
        }
      }
    }
  });
}

// ============================================
// TAB: MEETINGS
// ============================================

function renderMeetingsTab(main) {
  const { meetings, role } = AppState;
  const isAdmin = role === 'admin';

  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h4 class="mb-0">Meeting History</h4>
        ${isAdmin ? `
          <button class="btn btn-vcf-primary" data-bs-toggle="modal" data-bs-target="#meetingModal" onclick="window.editMeeting(null)">
            <i class="bi bi-plus-lg me-1"></i>Add Meeting
          </button>
        ` : ''}
      </div>

      ${meetings.length === 0 ? `
        <div class="text-center text-muted py-5">
          <i class="bi bi-calendar-x fs-1 mb-3 d-block"></i>
          <p>No meetings recorded yet.</p>
        </div>
      ` : `
        <div class="row g-4">
          ${meetings.map(m => `
            <div class="col-md-6 col-lg-4">
              <div class="card h-100">
                <div class="card-body">
                  <div class="d-flex justify-content-between align-items-start mb-2">
                    <span class="badge bg-vcf-primary">${formatDate(m.date)}</span>
                    ${isAdmin ? `
                      <div class="dropdown">
                        <button class="btn btn-link btn-sm p-0 text-muted" data-bs-toggle="dropdown">
                          <i class="bi bi-three-dots-vertical"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                          <li><a class="dropdown-item" href="#" onclick="window.editMeeting('${m.id}'); return false;">Edit</a></li>
                          <li><a class="dropdown-item text-danger" href="#" onclick="window.deleteMeeting('${m.id}'); return false;">Delete</a></li>
                        </ul>
                      </div>
                    ` : ''}
                  </div>
                  <h5 class="card-title">${m.title}</h5>
                  <p class="card-text text-muted small">${m.notes ? m.notes.substring(0, 150) + (m.notes.length > 150 ? '...' : '') : 'No notes'}</p>
                  ${m.presentation_links?.length > 0 ? `
                    <div class="mt-2">
                      ${m.presentation_links.map((link, i) => `
                        <a href="${link}" target="_blank" class="btn btn-sm btn-outline-primary me-1 mb-1">
                          <i class="bi bi-file-slides me-1"></i>Slides ${m.presentation_links.length > 1 ? i + 1 : ''}
                        </a>
                      `).join('')}
                    </div>
                  ` : ''}
                </div>
                <div class="card-footer bg-transparent">
                  <button class="btn btn-link btn-sm p-0" data-bs-toggle="modal" data-bs-target="#meetingDetailModal" onclick="window.showMeetingDetail('${m.id}')">
                    View Details <i class="bi bi-arrow-right"></i>
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>

    <!-- Meeting Detail Modal -->
    <div class="modal fade" id="meetingDetailModal" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="meetingDetailTitle">Meeting Details</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body" id="meetingDetailBody">
          </div>
        </div>
      </div>
    </div>

    <!-- Add/Edit Meeting Modal -->
    ${isAdmin ? `
      <div class="modal fade" id="meetingModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="meetingModalTitle">Add Meeting</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <input type="hidden" id="meetingId" />
              <div class="mb-3">
                <label class="form-label">Date</label>
                <input type="date" class="form-control" id="meetingDate" required />
              </div>
              <div class="mb-3">
                <label class="form-label">Title</label>
                <input type="text" class="form-control" id="meetingTitle" required />
              </div>
              <div class="mb-3">
                <label class="form-label">Notes</label>
                <textarea class="form-control" id="meetingNotes" rows="4"></textarea>
              </div>
              <div class="mb-3">
                <label class="form-label">Presentation Links (one per line)</label>
                <textarea class="form-control" id="meetingLinks" rows="2" placeholder="https://..."></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-vcf-primary" onclick="window.saveMeeting()">Save</button>
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  `;

  // Setup global handlers
  window.showMeetingDetail = (id) => {
    const meeting = AppState.meetings.find(m => m.id === id);
    if (!meeting) return;

    document.getElementById('meetingDetailTitle').textContent = meeting.title;
    document.getElementById('meetingDetailBody').innerHTML = `
      <p><strong>Date:</strong> ${formatDate(meeting.date)}</p>
      <hr />
      <h6>Notes</h6>
      <p class="text-muted" style="white-space: pre-wrap;">${meeting.notes || 'No notes recorded.'}</p>
      ${meeting.presentation_links?.length > 0 ? `
        <hr />
        <h6>Presentations</h6>
        ${meeting.presentation_links.map((link, i) => `
          <a href="${link}" target="_blank" class="btn btn-outline-primary me-2 mb-2">
            <i class="bi bi-file-slides me-1"></i>View Presentation ${meeting.presentation_links.length > 1 ? i + 1 : ''}
          </a>
        `).join('')}
      ` : ''}
    `;
  };

  window.editMeeting = (id) => {
    const meeting = id ? AppState.meetings.find(m => m.id === id) : null;

    document.getElementById('meetingModalTitle').textContent = meeting ? 'Edit Meeting' : 'Add Meeting';
    document.getElementById('meetingId').value = id || '';
    document.getElementById('meetingDate').value = meeting?.date || '';
    document.getElementById('meetingTitle').value = meeting?.title || '';
    document.getElementById('meetingNotes').value = meeting?.notes || '';
    document.getElementById('meetingLinks').value = meeting?.presentation_links?.join('\n') || '';

    const modalEl = document.getElementById('meetingModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();
  };

  window.saveMeeting = async () => {
    const id = document.getElementById('meetingId').value;
    const data = {
      date: document.getElementById('meetingDate').value,
      title: document.getElementById('meetingTitle').value,
      notes: document.getElementById('meetingNotes').value,
      presentation_links: document.getElementById('meetingLinks').value.split('\n').filter(l => l.trim())
    };

    if (id) {
      await supa.from('meetings').update(data).eq('id', id);
    } else {
      await supa.from('meetings').insert(data);
    }

    bootstrap.Modal.getInstance(document.getElementById('meetingModal')).hide();
    await loadAllData();
    renderMeetingsTab(document.getElementById('main'));
  };

  window.deleteMeeting = async (id) => {
    if (!confirm('Are you sure you want to delete this meeting?')) return;
    await supa.from('meetings').delete().eq('id', id);
    await loadAllData();
    renderMeetingsTab(document.getElementById('main'));
  };
}

// ============================================
// TAB: PITCHES
// ============================================

function renderPitchesTab(main) {
  const { pitches, votes, role, account, nav } = AppState;
  const isAdmin = role === 'admin';
  const canVote = isVotingEligible(account, nav);

  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h4 class="mb-0">Stock Pitches</h4>
        ${isAdmin ? `
          <button class="btn btn-vcf-primary" data-bs-toggle="modal" data-bs-target="#pitchModal" onclick="window.editPitch(null)">
            <i class="bi bi-plus-lg me-1"></i>Add Pitch
          </button>
        ` : ''}
      </div>

      ${!canVote ? `
        <div class="alert alert-info mb-4">
          <i class="bi bi-info-circle me-2"></i>
          You need a balance of $300+ or 290+ units to vote on pitches.
        </div>
      ` : ''}

      ${pitches.length === 0 ? `
        <div class="text-center text-muted py-5">
          <i class="bi bi-lightbulb fs-1 mb-3 d-block"></i>
          <p>No stock pitches yet.</p>
        </div>
      ` : `
        <div class="row g-4">
          ${pitches.map(p => {
            const pitchVotes = votes.filter(v => v.pitch_id === p.id);
            const yesVotes = pitchVotes.filter(v => v.vote_type === 'yes').length;
            const noVotes = pitchVotes.filter(v => v.vote_type === 'no').length;
            const abstainVotes = pitchVotes.filter(v => v.vote_type === 'abstain').length;
            const totalVotes = pitchVotes.length;
            const myVote = pitchVotes.find(v => v.voter_user_id === AppState.user?.id);

            return `
              <div class="col-md-6 col-lg-4">
                <div class="card h-100">
                  <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                      <div>
                        <h4 class="mb-0">${p.ticker}</h4>
                        <small class="text-muted">Pitched by ${p.pitched_by}</small>
                      </div>
                      <div class="d-flex align-items-center gap-2">
                        ${p.voting_open ? '<span class="badge bg-success">Voting Open</span>' : ''}
                        <span class="badge bg-${getStatusBadgeColor(p.status)}">${p.status}</span>
                        ${isAdmin ? `
                          <div class="dropdown">
                            <button class="btn btn-link btn-sm p-0 text-muted" data-bs-toggle="dropdown">
                              <i class="bi bi-three-dots-vertical"></i>
                            </button>
                            <ul class="dropdown-menu dropdown-menu-end">
                              <li><a class="dropdown-item" href="#" onclick="window.editPitch('${p.id}'); return false;">Edit</a></li>
                              <li><a class="dropdown-item" href="#" onclick="window.toggleVoting('${p.id}', ${!p.voting_open}); return false;">
                                ${p.voting_open ? 'Close Voting' : 'Open Voting'}
                              </a></li>
                              <li><hr class="dropdown-divider"></li>
                              <li><a class="dropdown-item text-danger" href="#" onclick="window.deletePitch('${p.id}'); return false;">Delete</a></li>
                            </ul>
                          </div>
                        ` : ''}
                      </div>
                    </div>

                    <p class="small text-muted mb-2">${formatDate(p.pitch_date)} • ${p.sector || 'No sector'}</p>
                    <p class="card-text">${p.summary || 'No summary provided.'}</p>

                    ${p.slideshow_url ? `
                      <a href="${p.slideshow_url}" target="_blank" class="btn btn-sm btn-outline-primary mb-3">
                        <i class="bi bi-file-slides me-1"></i>View Presentation
                      </a>
                    ` : ''}

                    ${p.voting_open || totalVotes > 0 ? `
                      <div class="mt-3 pt-3 border-top">
                        <div class="d-flex justify-content-between small mb-2">
                          <span>Yes: ${yesVotes}</span>
                          <span>No: ${noVotes}</span>
                          <span>Abstain: ${abstainVotes}</span>
                        </div>
                        <div class="progress" style="height: 8px;">
                          <div class="progress-bar bg-success" style="width: ${totalVotes ? (yesVotes/totalVotes)*100 : 0}%"></div>
                          <div class="progress-bar bg-danger" style="width: ${totalVotes ? (noVotes/totalVotes)*100 : 0}%"></div>
                          <div class="progress-bar bg-secondary" style="width: ${totalVotes ? (abstainVotes/totalVotes)*100 : 0}%"></div>
                        </div>

                        ${myVote ? `
                          <div class="mt-2 text-center">
                            <span class="badge bg-light text-dark">
                              <i class="bi bi-check-circle me-1"></i>You voted: ${myVote.vote_type}
                            </span>
                          </div>
                        ` : p.voting_open && canVote ? `
                          <div class="mt-3 d-flex gap-2 justify-content-center">
                            <button class="btn btn-sm btn-success" onclick="window.castVote('${p.id}', 'yes')">
                              <i class="bi bi-hand-thumbs-up"></i> Yes
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="window.castVote('${p.id}', 'no')">
                              <i class="bi bi-hand-thumbs-down"></i> No
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="window.castVote('${p.id}', 'abstain')">
                              Abstain
                            </button>
                          </div>
                        ` : ''}
                      </div>
                    ` : ''}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>

    <!-- Add/Edit Pitch Modal -->
    ${isAdmin ? `
      <div class="modal fade" id="pitchModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="pitchModalTitle">Add Pitch</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <input type="hidden" id="pitchId" />
              <div class="row">
                <div class="col-md-6 mb-3">
                  <label class="form-label">Ticker</label>
                  <input type="text" class="form-control" id="pitchTicker" required placeholder="AAPL" />
                </div>
                <div class="col-md-6 mb-3">
                  <label class="form-label">Pitched By</label>
                  <input type="text" class="form-control" id="pitchBy" required />
                </div>
              </div>
              <div class="row">
                <div class="col-md-6 mb-3">
                  <label class="form-label">Pitch Date</label>
                  <input type="date" class="form-control" id="pitchDate" required />
                </div>
                <div class="col-md-6 mb-3">
                  <label class="form-label">Sector</label>
                  <input type="text" class="form-control" id="pitchSector" placeholder="Technology" />
                </div>
              </div>
              <div class="mb-3">
                <label class="form-label">Summary</label>
                <textarea class="form-control" id="pitchSummary" rows="2"></textarea>
              </div>
              <div class="mb-3">
                <label class="form-label">Thesis</label>
                <textarea class="form-control" id="pitchThesis" rows="4"></textarea>
              </div>
              <div class="mb-3">
                <label class="form-label">Slideshow URL</label>
                <input type="url" class="form-control" id="pitchSlideshow" placeholder="https://..." />
              </div>
              <div class="row">
                <div class="col-md-6 mb-3">
                  <label class="form-label">Status</label>
                  <select class="form-select" id="pitchStatus">
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <div class="col-md-6 mb-3">
                  <label class="form-label">Voting</label>
                  <select class="form-select" id="pitchVotingOpen">
                    <option value="false">Closed</option>
                    <option value="true">Open</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-vcf-primary" onclick="window.savePitch()">Save</button>
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  `;

  // Setup global handlers
  window.editPitch = (id) => {
    const pitch = id ? AppState.pitches.find(p => p.id === id) : null;

    document.getElementById('pitchModalTitle').textContent = pitch ? 'Edit Pitch' : 'Add Pitch';
    document.getElementById('pitchId').value = id || '';
    document.getElementById('pitchTicker').value = pitch?.ticker || '';
    document.getElementById('pitchBy').value = pitch?.pitched_by || '';
    document.getElementById('pitchDate').value = pitch?.pitch_date || '';
    document.getElementById('pitchSector').value = pitch?.sector || '';
    document.getElementById('pitchSummary').value = pitch?.summary || '';
    document.getElementById('pitchThesis').value = pitch?.thesis || '';
    document.getElementById('pitchSlideshow').value = pitch?.slideshow_url || '';
    document.getElementById('pitchStatus').value = pitch?.status || 'pending';
    document.getElementById('pitchVotingOpen').value = pitch?.voting_open ? 'true' : 'false';

    const modalEl = document.getElementById('pitchModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();
  };

  window.savePitch = async () => {
    const id = document.getElementById('pitchId').value;
    const data = {
      ticker: document.getElementById('pitchTicker').value.toUpperCase(),
      pitched_by: document.getElementById('pitchBy').value,
      pitch_date: document.getElementById('pitchDate').value,
      sector: document.getElementById('pitchSector').value,
      summary: document.getElementById('pitchSummary').value,
      thesis: document.getElementById('pitchThesis').value,
      slideshow_url: document.getElementById('pitchSlideshow').value || null,
      status: document.getElementById('pitchStatus').value,
      voting_open: document.getElementById('pitchVotingOpen').value === 'true'
    };

    if (id) {
      await supa.from('pitches').update(data).eq('id', id);
    } else {
      data.created_by = AppState.user.id;
      await supa.from('pitches').insert(data);
    }

    bootstrap.Modal.getInstance(document.getElementById('pitchModal')).hide();
    await loadAllData();
    renderPitchesTab(document.getElementById('main'));
  };

  window.deletePitch = async (id) => {
    if (!confirm('Are you sure you want to delete this pitch? All votes will also be deleted.')) return;
    await supa.from('pitches').delete().eq('id', id);
    await loadAllData();
    renderPitchesTab(document.getElementById('main'));
  };

  window.toggleVoting = async (id, open) => {
    await supa.from('pitches').update({ voting_open: open }).eq('id', id);
    await loadAllData();
    renderPitchesTab(document.getElementById('main'));
  };

  window.castVote = async (pitchId, voteType) => {
    const { error } = await supa.from('votes').insert({
      pitch_id: pitchId,
      voter_user_id: AppState.user.id,
      voter_name: AppState.account.name,
      vote_type: voteType
    });

    if (error) {
      alert('Error casting vote: ' + error.message);
      return;
    }

    await loadAllData();
    renderPitchesTab(document.getElementById('main'));
  };
}

function getStatusBadgeColor(status) {
  switch (status) {
    case 'approved': return 'success';
    case 'rejected': return 'danger';
    default: return 'warning';
  }
}

// ============================================
// TAB: CHAT
// ============================================

function renderChatTab(main) {
  const { channels, role, account } = AppState;
  const isAdmin = role === 'admin';

  // Set default channel if not set
  if (!AppState.currentChannelId && channels.length > 0) {
    AppState.currentChannelId = channels[0].id;
  }

  const currentChannel = channels.find(c => c.id === AppState.currentChannelId);
  const canPost = currentChannel ? (currentChannel.admin_only_post ? isAdmin : true) : false;

  main.innerHTML = `
    <div class="container-fluid py-4 h-100">
      <div class="row g-0 chat-container" style="height: calc(100vh - 120px);">
        <!-- Channel Sidebar (Desktop) -->
        <div class="col-auto d-none d-md-block">
          <div class="chat-sidebar bg-light h-100" style="width: 200px; border-right: 1px solid #dee2e6;">
            <div class="p-3 border-bottom">
              <h6 class="mb-0 text-muted text-uppercase small">Channels</h6>
            </div>
            <div class="channel-list">
              ${channels.map(ch => `
                <div class="channel-item p-3 ${ch.id === AppState.currentChannelId ? 'active' : ''}"
                     data-channel-id="${ch.id}"
                     style="cursor: pointer; ${ch.id === AppState.currentChannelId ? 'background: var(--vcf-primary); color: white;' : ''}">
                  ${ch.admin_only_post ? '<i class="bi bi-megaphone me-2"></i>' : '<i class="bi bi-hash me-2"></i>'}
                  ${ch.name}
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Main Chat Area -->
        <div class="col d-flex flex-column h-100">
          <!-- Mobile Channel Selector -->
          <div class="d-md-none p-3 border-bottom bg-light">
            <select class="form-select" id="channelSelect">
              ${channels.map(ch => `
                <option value="${ch.id}" ${ch.id === AppState.currentChannelId ? 'selected' : ''}>
                  ${ch.admin_only_post ? '📢 ' : '# '}${ch.name}
                </option>
              `).join('')}
            </select>
          </div>

          <!-- Channel Header -->
          <div class="chat-header p-3 border-bottom d-none d-md-block">
            <h5 class="mb-0">
              ${currentChannel?.admin_only_post ? '<i class="bi bi-megaphone me-2"></i>' : '<i class="bi bi-hash me-2"></i>'}
              ${currentChannel?.name || 'Select a channel'}
            </h5>
            <small class="text-muted">${currentChannel?.description || ''}</small>
          </div>

          <!-- Messages Area -->
          <div class="chat-messages flex-grow-1 p-3" id="chatMessages" style="overflow-y: auto; background: #fff;">
            <div class="text-center text-muted py-5">
              <div class="spinner-border spinner-border-sm me-2" role="status"></div>
              Loading messages...
            </div>
          </div>

          <!-- Message Input -->
          <div class="chat-input p-3 border-top bg-white">
            ${canPost ? `
              <form id="chatForm" class="d-flex gap-2">
                <input type="text"
                       class="form-control"
                       id="messageInput"
                       placeholder="Type a message..."
                       autocomplete="off"
                       style="border-radius: 20px;" />
                <button type="submit" class="btn btn-vcf-primary px-3" style="border-radius: 20px;">
                  <i class="bi bi-send"></i>
                </button>
              </form>
            ` : `
              <div class="text-center text-muted py-2">
                <i class="bi bi-lock me-2"></i>Only admins can post in this channel
              </div>
            `}
          </div>
        </div>
      </div>
    </div>
  `;

  // Setup event listeners
  setupChatEventListeners();

  // Load messages for current channel
  if (AppState.currentChannelId) {
    loadChatMessages(AppState.currentChannelId);
    subscribeToChatMessages(AppState.currentChannelId);
  }
}

function setupChatEventListeners() {
  // Desktop channel switching
  document.querySelectorAll('.channel-item').forEach(item => {
    item.onclick = () => {
      const channelId = item.dataset.channelId;
      switchChannel(channelId);
    };
  });

  // Mobile channel switching
  const channelSelect = document.getElementById('channelSelect');
  if (channelSelect) {
    channelSelect.onchange = () => {
      switchChannel(channelSelect.value);
    };
  }

  // Message form submission
  const chatForm = document.getElementById('chatForm');
  if (chatForm) {
    chatForm.onsubmit = async (e) => {
      e.preventDefault();
      const input = document.getElementById('messageInput');
      const content = input.value.trim();

      if (!content) return;

      input.disabled = true;

      try {
        await sendChatMessage(AppState.currentChannelId, content);
        input.value = '';
      } catch (error) {
        console.error('Failed to send message:', error);
        alert('Failed to send message. Please try again.');
      } finally {
        input.disabled = false;
        input.focus();
      }
    };
  }
}

function switchChannel(channelId) {
  if (channelId === AppState.currentChannelId) return;

  // Unsubscribe from current channel
  if (AppState.chatSubscription) {
    supa.removeChannel(AppState.chatSubscription);
    AppState.chatSubscription = null;
  }

  AppState.currentChannelId = channelId;
  renderChatTab(document.getElementById('main'));
}

async function loadChatMessages(channelId) {
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;

  // Check if we have cached messages
  if (AppState.chatMessages[channelId]) {
    renderChatMessages(AppState.chatMessages[channelId]);
    return;
  }

  try {
    const { data: messages, error } = await supa
      .from('messages')
      .select('*')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) throw error;

    AppState.chatMessages[channelId] = messages || [];
    renderChatMessages(messages || []);
  } catch (error) {
    console.error('Failed to load messages:', error);
    messagesContainer.innerHTML = `
      <div class="text-center text-danger py-5">
        <p>Failed to load messages</p>
        <button class="btn btn-primary btn-sm" onclick="loadChatMessages('${channelId}')">
          Retry
        </button>
      </div>
    `;
  }
}

function renderChatMessages(messages) {
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;

  if (messages.length === 0) {
    messagesContainer.innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="bi bi-chat-dots fs-1 mb-3 d-block"></i>
        <p>No messages yet. Start the conversation!</p>
      </div>
    `;
    return;
  }

  let html = '';
  let lastUserId = null;

  messages.forEach((msg, index) => {
    const isNewUser = msg.user_id !== lastUserId;
    const time = new Date(msg.created_at).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    if (isNewUser) {
      const avatar = msg.user_avatar
        ? `<img src="${msg.user_avatar}" class="rounded-circle" width="32" height="32" alt="${msg.user_name}" />`
        : `<div class="rounded-circle d-flex align-items-center justify-content-center text-white"
               style="width: 32px; height: 32px; background: #6b7280; font-size: 12px; font-weight: bold;">
             ${getInitials(msg.user_name)}
           </div>`;

      html += `
        <div class="message-group mb-2">
          <div class="d-flex">
            <div class="flex-shrink-0" style="width: 40px;">${avatar}</div>
            <div class="flex-grow-1" style="min-width: 0;">
              <div class="d-flex align-items-baseline gap-2">
                <span class="fw-semibold" style="font-size: 14px;">${escapeHtml(msg.user_name)}</span>
                <span class="text-muted" style="font-size: 11px;">${time}</span>
              </div>
              <div style="font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(msg.content)}</div>
            </div>
          </div>
        </div>
      `;
    } else {
      // Same user, add message without avatar/name
      html += `
        <div class="message-continuation" style="margin-left: 40px; margin-bottom: 2px;">
          <div style="font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(msg.content)}</div>
        </div>
      `;
    }

    lastUserId = msg.user_id;
  });

  messagesContainer.innerHTML = html;
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const messagesContainer = document.getElementById('chatMessages');
  if (messagesContainer) {
    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: 'smooth'
    });
  }
}

function subscribeToChatMessages(channelId) {
  // Clean up existing subscription
  if (AppState.chatSubscription) {
    supa.removeChannel(AppState.chatSubscription);
  }

  AppState.chatSubscription = supa
    .channel(`messages:${channelId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`
      },
      (payload) => {
        const newMessage = payload.new;

        // Add to cache
        if (!AppState.chatMessages[channelId]) {
          AppState.chatMessages[channelId] = [];
        }
        AppState.chatMessages[channelId].push(newMessage);

        // Append to UI
        appendChatMessage(newMessage);
        scrollChatToBottom();
      }
    )
    .subscribe();
}

function appendChatMessage(message) {
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;

  // Check if this is from a different user than the last message
  const messages = AppState.chatMessages[AppState.currentChannelId] || [];
  const prevMessage = messages.length > 1 ? messages[messages.length - 2] : null;
  const isNewUser = !prevMessage || prevMessage.user_id !== message.user_id;

  const time = new Date(message.created_at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  // Remove empty state if present
  const emptyState = messagesContainer.querySelector('.text-center.text-muted');
  if (emptyState && emptyState.textContent.includes('No messages')) {
    messagesContainer.innerHTML = '';
  }

  const messageHtml = document.createElement('div');

  if (isNewUser) {
    const avatar = message.user_avatar
      ? `<img src="${message.user_avatar}" class="rounded-circle" width="32" height="32" alt="${message.user_name}" />`
      : `<div class="rounded-circle d-flex align-items-center justify-content-center text-white"
             style="width: 32px; height: 32px; background: #6b7280; font-size: 12px; font-weight: bold;">
           ${getInitials(message.user_name)}
         </div>`;

    messageHtml.className = 'message-group mb-2 chat-message-new';
    messageHtml.innerHTML = `
      <div class="d-flex">
        <div class="flex-shrink-0" style="width: 40px;">${avatar}</div>
        <div class="flex-grow-1" style="min-width: 0;">
          <div class="d-flex align-items-baseline gap-2">
            <span class="fw-semibold" style="font-size: 14px;">${escapeHtml(message.user_name)}</span>
            <span class="text-muted" style="font-size: 11px;">${time}</span>
          </div>
          <div style="font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(message.content)}</div>
        </div>
      </div>
    `;
  } else {
    messageHtml.className = 'message-continuation chat-message-new';
    messageHtml.style.marginLeft = '40px';
    messageHtml.style.marginBottom = '2px';
    messageHtml.innerHTML = `
      <div style="font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(message.content)}</div>
    `;
  }

  messagesContainer.appendChild(messageHtml);
}

async function sendChatMessage(channelId, content) {
  const { error } = await supa
    .from('messages')
    .insert({
      channel_id: channelId,
      user_id: AppState.user.id,
      user_name: AppState.account.name,
      user_avatar: AppState.account.profile_picture_url || null,
      content: content.trim()
    });

  if (error) throw error;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// TAB: RESOURCES
// ============================================

function renderResourcesTab(main) {
  const { resources, role } = AppState;
  const isAdmin = role === 'admin';

  // Group by category
  const grouped = resources.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category].push(r);
    return acc;
  }, {});

  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h4 class="mb-0">Educational Resources</h4>
        ${isAdmin ? `
          <button class="btn btn-vcf-primary" data-bs-toggle="modal" data-bs-target="#resourceModal" onclick="window.editResource(null)">
            <i class="bi bi-plus-lg me-1"></i>Add Resource
          </button>
        ` : ''}
      </div>

      ${resources.length === 0 ? `
        <div class="text-center text-muted py-5">
          <i class="bi bi-book fs-1 mb-3 d-block"></i>
          <p>No resources available yet.</p>
        </div>
      ` : `
        ${Object.entries(grouped).map(([category, items]) => `
          <div class="mb-4">
            <h5 class="mb-3">
              <i class="bi bi-folder me-2"></i>${category}
            </h5>
            <div class="list-group">
              ${items.map(r => `
                <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                  <div>
                    <a href="${r.url}" target="_blank" class="text-decoration-none">
                      <h6 class="mb-1">${r.title}</h6>
                    </a>
                    <p class="mb-0 small text-muted">${r.description || ''}</p>
                  </div>
                  <div class="d-flex align-items-center gap-2">
                    <a href="${r.url}" target="_blank" class="btn btn-sm btn-outline-primary">
                      <i class="bi bi-box-arrow-up-right"></i>
                    </a>
                    ${isAdmin ? `
                      <div class="dropdown">
                        <button class="btn btn-sm btn-outline-secondary" data-bs-toggle="dropdown">
                          <i class="bi bi-three-dots"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                          <li><a class="dropdown-item" href="#" onclick="window.editResource('${r.id}'); return false;">Edit</a></li>
                          <li><a class="dropdown-item text-danger" href="#" onclick="window.deleteResource('${r.id}'); return false;">Delete</a></li>
                        </ul>
                      </div>
                    ` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      `}
    </div>

    <!-- Add/Edit Resource Modal -->
    ${isAdmin ? `
      <div class="modal fade" id="resourceModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="resourceModalTitle">Add Resource</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <input type="hidden" id="resourceId" />
              <div class="mb-3">
                <label class="form-label">Title</label>
                <input type="text" class="form-control" id="resourceTitle" required />
              </div>
              <div class="mb-3">
                <label class="form-label">URL</label>
                <input type="url" class="form-control" id="resourceUrl" required placeholder="https://..." />
              </div>
              <div class="mb-3">
                <label class="form-label">Category</label>
                <input type="text" class="form-control" id="resourceCategory" required placeholder="e.g., Valuation, Technical Analysis" list="categoryList" />
                <datalist id="categoryList">
                  ${[...new Set(resources.map(r => r.category))].map(c => `<option value="${c}">`).join('')}
                </datalist>
              </div>
              <div class="mb-3">
                <label class="form-label">Description</label>
                <textarea class="form-control" id="resourceDescription" rows="2"></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-vcf-primary" onclick="window.saveResource()">Save</button>
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  `;

  // Setup global handlers
  window.editResource = (id) => {
    const resource = id ? AppState.resources.find(r => r.id === id) : null;

    document.getElementById('resourceModalTitle').textContent = resource ? 'Edit Resource' : 'Add Resource';
    document.getElementById('resourceId').value = id || '';
    document.getElementById('resourceTitle').value = resource?.title || '';
    document.getElementById('resourceUrl').value = resource?.url || '';
    document.getElementById('resourceCategory').value = resource?.category || '';
    document.getElementById('resourceDescription').value = resource?.description || '';

    const modalEl = document.getElementById('resourceModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();
  };

  window.saveResource = async () => {
    const id = document.getElementById('resourceId').value;
    const data = {
      title: document.getElementById('resourceTitle').value,
      url: document.getElementById('resourceUrl').value,
      category: document.getElementById('resourceCategory').value,
      description: document.getElementById('resourceDescription').value
    };

    if (id) {
      await supa.from('resources').update(data).eq('id', id);
    } else {
      await supa.from('resources').insert(data);
    }

    bootstrap.Modal.getInstance(document.getElementById('resourceModal')).hide();
    await loadAllData();
    renderResourcesTab(document.getElementById('main'));
  };

  window.deleteResource = async (id) => {
    if (!confirm('Are you sure you want to delete this resource?')) return;
    await supa.from('resources').delete().eq('id', id);
    await loadAllData();
    renderResourcesTab(document.getElementById('main'));
  };
}

// ============================================
// TAB: ACCOUNT MANAGEMENT
// ============================================

function renderAccountTab(main) {
  const { account, accounts, role, nav, fundValue } = AppState;
  const isAdmin = role === 'admin';

  main.innerHTML = `
    <div class="container-fluid py-4">
      <h4 class="mb-4">Account Management</h4>

      <div class="row g-4">
        <!-- My Profile -->
        <div class="col-lg-6">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title mb-4">My Profile</h5>

              <div class="text-center mb-4">
                ${renderProfilePicture(account, 'lg')}
                <div class="mt-3">
                  <input type="file" class="d-none" id="profilePicInput" accept="image/jpeg,image/png" />
                  <button class="btn btn-sm btn-outline-primary" onclick="document.getElementById('profilePicInput').click()">
                    <i class="bi bi-camera me-1"></i>Change Photo
                  </button>
                </div>
              </div>

              <div class="mb-3">
                <label class="form-label text-muted small">Name</label>
                <p class="mb-0 fw-semibold">${account?.name || '-'}</p>
              </div>

              <div class="mb-3">
                <label class="form-label text-muted small">Email</label>
                <p class="mb-0">${AppState.user?.email || '-'}</p>
              </div>

              <div class="row">
                <div class="col-6">
                  <label class="form-label text-muted small">Units</label>
                  <p class="mb-0 fw-semibold">${Number(account?.units || 0).toFixed(2)}</p>
                </div>
                <div class="col-6">
                  <label class="form-label text-muted small">Balance</label>
                  <p class="mb-0 fw-semibold">${formatCurrency(AppState.myBalance)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        ${isAdmin ? `
          <!-- All Accounts (Admin) -->
          <div class="col-lg-6">
            <div class="card">
              <div class="card-body">
                <h5 class="card-title mb-4">All Accounts</h5>
                <div class="table-responsive">
                  <table class="table table-sm">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th class="text-end">Units</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${accounts.map(a => `
                        <tr>
                          <td>
                            ${renderProfilePicture(a, 'sm')}
                            <span class="ms-2">${a.name}</span>
                          </td>
                          <td class="text-muted">${a.role || 'investor'}</td>
                          <td class="text-end">${(Number(a.units) || 0).toFixed(2)}</td>
                          <td class="text-end">
                            <button class="btn btn-sm btn-link" onclick="window.editAccount('${a.id}')">
                              <i class="bi bi-pencil"></i>
                            </button>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Edit Account Modal (Admin) -->
    ${isAdmin ? `
      <div class="modal fade" id="editAccountModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Edit Account</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <input type="hidden" id="editAccountId" />
              <div class="mb-3">
                <label class="form-label">Name</label>
                <input type="text" class="form-control" id="editAccountName" />
              </div>
              <div class="mb-3">
                <label class="form-label">Role</label>
                <select class="form-select" id="editAccountRole">
                  <option value="investor">Investor</option>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">Units</label>
                <input type="number" class="form-control" id="editAccountUnits" step="0.01" />
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-vcf-primary" onclick="window.saveAccount()">Save</button>
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  `;

  // Setup profile picture upload
  document.getElementById('profilePicInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('File must be under 2MB');
      return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['jpg', 'jpeg', 'png'].includes(ext)) {
      alert('Only JPG and PNG files are allowed');
      return;
    }

    const filePath = `${AppState.user.id}.${ext}`;

    const { error: uploadError } = await supa.storage
      .from('profile-pictures')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      alert('Upload failed: ' + uploadError.message);
      return;
    }

    const { data: { publicUrl } } = supa.storage
      .from('profile-pictures')
      .getPublicUrl(filePath);

    await supa.from('accounts')
      .update({ profile_picture_url: publicUrl + '?t=' + Date.now() })
      .eq('id', account.id);

    await loadAllData();
    AppState.account = AppState.accounts.find(a => a.owner_user_id === AppState.user.id);
    renderAccountTab(document.getElementById('main'));
  };

  // Admin handlers
  if (isAdmin) {
    window.editAccount = (id) => {
      const acc = AppState.accounts.find(a => a.id === id);
      if (!acc) return;

      document.getElementById('editAccountId').value = id;
      document.getElementById('editAccountName').value = acc.name || '';
      document.getElementById('editAccountRole').value = acc.role || 'investor';
      document.getElementById('editAccountUnits').value = acc.units || 0;

      const modalEl = document.getElementById('editAccountModal');
      const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      modal.show();
    };

    window.saveAccount = async () => {
      const id = document.getElementById('editAccountId').value;
      const data = {
        name: document.getElementById('editAccountName').value,
        role: document.getElementById('editAccountRole').value,
        units: parseFloat(document.getElementById('editAccountUnits').value) || 0
      };

      await supa.from('accounts').update(data).eq('id', id);

      bootstrap.Modal.getInstance(document.getElementById('editAccountModal')).hide();
      await loadAllData();
      AppState.account = AppState.accounts.find(a => a.owner_user_id === AppState.user.id);
      AppState.role = AppState.account?.role || 'investor';
      renderAccountTab(document.getElementById('main'));
    };
  }
}

// ============================================
// TAB: VOTE MANAGEMENT
// ============================================

function renderVoteManagement(main) {
  const { pitches, votes, accounts, nav } = AppState;

  const votingPitches = pitches.filter(p => p.voting_open || votes.some(v => v.pitch_id === p.id));

  // Get eligible voters
  const eligibleVoters = accounts.filter(a => isVotingEligible(a, nav));

  main.innerHTML = `
    <div class="container-fluid py-4">
      <h4 class="mb-4"><i class="bi bi-check2-square me-2"></i>Vote Management</h4>

      ${votingPitches.length === 0 ? `
        <div class="text-center text-muted py-5">
          <i class="bi bi-inbox fs-1 mb-3 d-block"></i>
          <p>No pitches with votes yet.</p>
          <a href="#pitches" class="btn btn-vcf-primary">Create a Pitch</a>
        </div>
      ` : `
        <div class="row g-4">
          <div class="col-lg-8">
            <!-- Pitch Selector -->
            <div class="card mb-4">
              <div class="card-body">
                <label class="form-label">Select Pitch</label>
                <select class="form-select" id="votePitchSelect" onchange="window.renderVoteDetails()">
                  <option value="">Choose a pitch...</option>
                  ${votingPitches.map(p => `
                    <option value="${p.id}">${p.ticker} - ${p.pitched_by} (${formatDate(p.pitch_date)})</option>
                  `).join('')}
                </select>
              </div>
            </div>

            <!-- Vote Details -->
            <div id="voteDetails"></div>
          </div>

          <div class="col-lg-4">
            <!-- Eligible Voters -->
            <div class="card admin-terminal">
              <div class="card-body">
                <h6 class="mb-3">Eligible Voters (${eligibleVoters.length})</h6>
                <ul class="list-unstyled mb-0 small">
                  ${eligibleVoters.map(a => `
                    <li class="mb-2">
                      <i class="bi bi-person me-1"></i>${a.name}
                      <span class="text-muted">(${formatCurrency(a.units * nav)})</span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            </div>
          </div>
        </div>
      `}
    </div>
  `;

  window.renderVoteDetails = () => {
    const pitchId = document.getElementById('votePitchSelect')?.value;
    const container = document.getElementById('voteDetails');
    if (!container) return;

    if (!pitchId) {
      container.innerHTML = '';
      return;
    }

    const pitch = AppState.pitches.find(p => p.id === pitchId);
    const pitchVotes = AppState.votes.filter(v => v.pitch_id === pitchId);
    const yesVotes = pitchVotes.filter(v => v.vote_type === 'yes');
    const noVotes = pitchVotes.filter(v => v.vote_type === 'no');
    const abstainVotes = pitchVotes.filter(v => v.vote_type === 'abstain');
    const totalVotes = pitchVotes.length;

    // Recalculate eligible voters from current state
    const currentEligibleVoters = AppState.accounts.filter(a => isVotingEligible(a, AppState.nav));
    const voterIds = pitchVotes.map(v => v.voter_user_id);
    const notVoted = currentEligibleVoters.filter(a => !voterIds.includes(a.owner_user_id));

    container.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start mb-4">
            <div>
              <h5>${pitch.ticker}</h5>
              <p class="text-muted mb-0">Pitched by ${pitch.pitched_by} on ${formatDate(pitch.pitch_date)}</p>
            </div>
            <div>
              ${pitch.voting_open ? `
                <span class="badge bg-success me-2">Voting Open</span>
                <button class="btn btn-sm btn-outline-danger" onclick="window.closeVoting('${pitchId}')">
                  Close Voting
                </button>
              ` : `
                <span class="badge bg-secondary me-2">Voting Closed</span>
                <button class="btn btn-sm btn-outline-success" onclick="window.openVoting('${pitchId}')">
                  Reopen Voting
                </button>
              `}
            </div>
          </div>

          <!-- Vote Summary -->
          <div class="row mb-4">
            <div class="col-md-4">
              <div class="text-center p-3 bg-success bg-opacity-10 rounded">
                <h3 class="text-success mb-0">${yesVotes.length}</h3>
                <small class="text-muted">Yes</small>
              </div>
            </div>
            <div class="col-md-4">
              <div class="text-center p-3 bg-danger bg-opacity-10 rounded">
                <h3 class="text-danger mb-0">${noVotes.length}</h3>
                <small class="text-muted">No</small>
              </div>
            </div>
            <div class="col-md-4">
              <div class="text-center p-3 bg-secondary bg-opacity-10 rounded">
                <h3 class="text-secondary mb-0">${abstainVotes.length}</h3>
                <small class="text-muted">Abstain</small>
              </div>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="progress mb-4" style="height: 24px;">
            <div class="progress-bar bg-success" style="width: ${totalVotes ? (yesVotes.length/totalVotes)*100 : 0}%">
              ${totalVotes ? Math.round((yesVotes.length/totalVotes)*100) : 0}%
            </div>
            <div class="progress-bar bg-danger" style="width: ${totalVotes ? (noVotes.length/totalVotes)*100 : 0}%">
              ${totalVotes ? Math.round((noVotes.length/totalVotes)*100) : 0}%
            </div>
            <div class="progress-bar bg-secondary" style="width: ${totalVotes ? (abstainVotes.length/totalVotes)*100 : 0}%">
            </div>
          </div>

          <!-- Voters List -->
          <div class="row">
            <div class="col-md-6">
              <h6>Votes Cast (${totalVotes})</h6>
              <ul class="list-group list-group-flush">
                ${pitchVotes.map(v => `
                  <li class="list-group-item d-flex justify-content-between align-items-center px-0">
                    ${v.voter_name}
                    <span class="badge bg-${v.vote_type === 'yes' ? 'success' : v.vote_type === 'no' ? 'danger' : 'secondary'}">
                      ${v.vote_type}
                    </span>
                  </li>
                `).join('')}
              </ul>
            </div>
            <div class="col-md-6">
              <h6>Not Yet Voted (${notVoted.length})</h6>
              <ul class="list-group list-group-flush">
                ${notVoted.map(a => `
                  <li class="list-group-item px-0 text-muted">${a.name}</li>
                `).join('')}
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;
  };

  window.closeVoting = async (pitchId) => {
    await supa.from('pitches').update({ voting_open: false }).eq('id', pitchId);
    await loadAllData();
    renderVoteManagement(document.getElementById('main'));
  };

  window.openVoting = async (pitchId) => {
    await supa.from('pitches').update({ voting_open: true }).eq('id', pitchId);
    await loadAllData();
    renderVoteManagement(document.getElementById('main'));
  };
}

// ============================================
// TAB: DATA TOOLS
// ============================================

function renderDataTools(main) {
  const { holdings, accounts, enrichedHoldings } = AppState;

  main.innerHTML = `
    <div class="container-fluid py-4">
      <h4 class="mb-4"><i class="bi bi-database me-2"></i>Data Tools</h4>

      <div class="row g-4">
        <!-- Add Position -->
        <div class="col-lg-6">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title mb-4">Add Position</h5>
              <div id="addPositionMsg" class="alert d-none"></div>

              <div class="row mb-3">
                <div class="col-md-6">
                  <label class="form-label">Symbol</label>
                  <input type="text" class="form-control" id="newSymbol" placeholder="AAPL" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Sector</label>
                  <input type="text" class="form-control" id="newSector" placeholder="Technology" list="sectorList" />
                  <datalist id="sectorList">
                    ${[...new Set(holdings.map(h => h.sector).filter(Boolean))].map(s => `<option value="${s}">`).join('')}
                  </datalist>
                </div>
              </div>

              <div class="row mb-3">
                <div class="col-md-6">
                  <label class="form-label">Shares</label>
                  <input type="number" class="form-control" id="newShares" step="0.01" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Cost Basis (per share)</label>
                  <input type="number" class="form-control" id="newCostBasis" step="0.01" />
                </div>
              </div>

              <div class="mb-3">
                <label class="form-label">Purchase Date (optional)</label>
                <input type="date" class="form-control" id="newPurchaseDate" />
              </div>

              <p class="small text-muted mb-3">
                <i class="bi bi-info-circle me-1"></i>
                If you add to an existing position, cost basis will be weighted averaged.
              </p>

              <button class="btn btn-vcf-primary" onclick="window.addPosition()">
                <i class="bi bi-plus-lg me-1"></i>Add Position
              </button>
            </div>
          </div>
        </div>

        <!-- Export Data -->
        <div class="col-lg-6">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title mb-4">Export Data</h5>

              <div class="d-grid gap-3">
                <button class="btn btn-outline-primary" onclick="window.exportHoldings()">
                  <i class="bi bi-download me-2"></i>Export Holdings (CSV)
                </button>
                <button class="btn btn-outline-primary" onclick="window.exportAccounts()">
                  <i class="bi bi-download me-2"></i>Export Accounts (CSV)
                </button>
              </div>

              <hr class="my-4" />

              <h6>Current Holdings</h6>
              <div class="table-responsive" style="max-height: 300px; overflow-y: auto;">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Shares</th>
                      <th>Cost</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${holdings.map(h => `
                      <tr>
                        <td>${h.symbol}</td>
                        <td>${h.shares}</td>
                        <td>${formatCurrency(h.cost_basis)}</td>
                        <td>
                          <button class="btn btn-sm btn-link text-danger p-0" onclick="window.deleteHolding('${h.id}')">
                            <i class="bi bi-trash"></i>
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- Add Benchmark Data -->
        <div class="col-lg-6">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title mb-4">Add Benchmark Data</h5>
              <div id="addBenchmarkMsg" class="alert d-none"></div>

              <div class="row mb-3">
                <div class="col-md-6">
                  <label class="form-label">Date</label>
                  <input type="date" class="form-control" id="benchmarkDate" />
                </div>
              </div>

              <div class="row mb-3">
                <div class="col-md-6">
                  <label class="form-label">S&P 500 Close</label>
                  <input type="number" class="form-control" id="benchmarkSP500" step="0.01" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Fund NAV</label>
                  <input type="number" class="form-control" id="benchmarkNAV" step="0.0001" value="${(AppState.nav || 0).toFixed(4)}" />
                </div>
              </div>

              <button class="btn btn-vcf-primary" onclick="window.addBenchmark()">
                <i class="bi bi-plus-lg me-1"></i>Add Data Point
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Add position handler
  window.addPosition = async () => {
    const symbol = document.getElementById('newSymbol').value.toUpperCase().trim();
    const sector = document.getElementById('newSector').value.trim();
    const shares = parseFloat(document.getElementById('newShares').value);
    const costBasis = parseFloat(document.getElementById('newCostBasis').value);
    const purchaseDate = document.getElementById('newPurchaseDate').value || null;

    const msgEl = document.getElementById('addPositionMsg');
    const showMsg = (text, type) => {
      msgEl.textContent = text;
      msgEl.className = `alert alert-${type}`;
    };

    if (!symbol || !shares || !costBasis) {
      showMsg('Please fill in symbol, shares, and cost basis.', 'danger');
      return;
    }

    // Check if position exists
    const existing = holdings.find(h => h.symbol === symbol);

    if (existing) {
      // Weighted average cost basis
      const totalShares = Number(existing.shares) + shares;
      const totalCost = (Number(existing.shares) * Number(existing.cost_basis)) + (shares * costBasis);
      const newCostBasis = totalCost / totalShares;

      await supa.from('holdings').update({
        shares: totalShares,
        cost_basis: newCostBasis,
        sector: sector || existing.sector
      }).eq('id', existing.id);

      showMsg(`Updated ${symbol}: ${totalShares} shares @ ${formatCurrency(newCostBasis)} avg`, 'success');
    } else {
      await supa.from('holdings').insert({
        symbol,
        shares,
        cost_basis: costBasis,
        sector: sector || null,
        purchase_date: purchaseDate
      });

      showMsg(`Added ${symbol}: ${shares} shares @ ${formatCurrency(costBasis)}`, 'success');
    }

    // Clear form
    document.getElementById('newSymbol').value = '';
    document.getElementById('newSector').value = '';
    document.getElementById('newShares').value = '';
    document.getElementById('newCostBasis').value = '';
    document.getElementById('newPurchaseDate').value = '';

    await loadAllData();
    renderDataTools(document.getElementById('main'));
  };

  // Delete holding handler
  window.deleteHolding = async (id) => {
    if (!confirm('Are you sure you want to delete this position?')) return;
    await supa.from('holdings').delete().eq('id', id);
    await loadAllData();
    renderDataTools(document.getElementById('main'));
  };

  // Export handlers
  window.exportHoldings = () => {
    const headers = ['Symbol', 'Sector', 'Shares', 'Cost Basis', 'Price', 'Market Value', 'P/L'];
    const rows = enrichedHoldings.map(h => [
      h.symbol,
      h.sector || '',
      h.shares || 0,
      h.cost_basis || 0,
      h.price || 0,
      (h.marketValue || 0).toFixed(2),
      (h.pnl || 0).toFixed(2)
    ]);

    downloadCSV([headers, ...rows], 'holdings.csv');
  };

  window.exportAccounts = () => {
    const headers = ['Name', 'Role', 'Units', 'Balance', '% of Fund'];
    const rows = accounts.map(a => {
      const units = Number(a.units) || 0;
      const balance = units * (AppState.nav || 0);
      const pct = AppState.fundValue > 0 ? (balance / AppState.fundValue) * 100 : 0;
      return [
        a.name,
        a.role || 'investor',
        units,
        (balance || 0).toFixed(2),
        (pct || 0).toFixed(2) + '%'
      ];
    });

    downloadCSV([headers, ...rows], 'accounts.csv');
  };

  // Add benchmark handler
  window.addBenchmark = async () => {
    const date = document.getElementById('benchmarkDate').value;
    const sp500 = parseFloat(document.getElementById('benchmarkSP500').value);
    const nav = parseFloat(document.getElementById('benchmarkNAV').value);

    const msgEl = document.getElementById('addBenchmarkMsg');
    const showMsg = (text, type) => {
      msgEl.textContent = text;
      msgEl.className = `alert alert-${type}`;
    };

    if (!date || !sp500 || !nav) {
      showMsg('Please fill in all fields.', 'danger');
      return;
    }

    const { error } = await supa.from('benchmark_data').upsert({
      date,
      sp500_close: sp500,
      fund_nav: nav
    }, { onConflict: 'date' });

    if (error) {
      showMsg('Error: ' + error.message, 'danger');
      return;
    }

    showMsg('Benchmark data added successfully.', 'success');

    document.getElementById('benchmarkDate').value = '';
    document.getElementById('benchmarkSP500').value = '';

    await loadAllData();
  };
}

function downloadCSV(rows, filename) {
  const csv = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================
// INITIALIZATION
// ============================================

let isInitializing = false;

async function init() {
  // Prevent double initialization
  if (isInitializing) {
    console.log('Init already in progress, skipping');
    return;
  }
  isInitializing = true;

  try {
    const hasSession = await checkSession();

    if (!hasSession) {
      renderLogin();
      return;
    }

    renderLoading();
    await loadAllData();

    // Find user's account
    AppState.account = AppState.accounts.find(a => a.owner_user_id === AppState.user.id);

    if (!AppState.account) {
      renderNoAccount();
      return;
    }

    // Set role
    AppState.role = AppState.account.role || 'investor';
    AppState.myBalance = (Number(AppState.account.units) || 0) * (AppState.nav || 0);

    // Render layout
    renderLayout();

  } catch (error) {
    console.error('Error initializing app:', error);
    app.innerHTML = `
      <div class="d-flex align-items-center justify-content-center min-vh-100">
        <div class="alert alert-danger">
          Error loading data. Please refresh the page.
        </div>
      </div>
    `;
  } finally {
    isInitializing = false;
  }
}

// Auth state change listener
supa.auth.onAuthStateChange((event, session) => {
  // Only re-init on sign in/out events, not on initial load
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
    init();
  }
});

// Listen for hash changes (for browser back/forward)
window.addEventListener('hashchange', () => {
  if (AppState.user && AppState.account) {
    handleRouteChange();
  }
});

// Start app
init();

// Auto-refresh data every 2 minutes
setInterval(async () => {
  if (AppState.user && AppState.account) {
    await loadAllData();
    renderCurrentTab();
  }
}, 120000);
