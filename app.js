
const SUPABASE_URL = "https://vzzxdwvebxckjtuezwzo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6enhkd3ZlYnhja2p0dWV6d3pvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyNDMyODAsImV4cCI6MjA4MzgxOTI4MH0.kyfCzC-AAdTezTJ6VZV8DndFP8MDh8gIRCPzM_V8vbQ";

const supa = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

supa.auth.onAuthStateChange(() => {
  init();
});


// Root container
const app = document.getElementById("app");

// 2. Entry point
init();

async function init() {
  const {
    data: { session }
  } = await supa.auth.getSession();

  if (!session) {
    renderLogin();
  } else {
    renderDashboard();
  }
}
// stock api
const FINNHUB_KEY = "d5jgi69r01qgsosg5790d5jgi69r01qgsosg579g";

let priceCache = null;
let lastFetch = 0;

async function fetchPrices(symbols) {
  const now = Date.now();

  // Reuse prices for 60 seconds
  if (priceCache && now - lastFetch < 60_000) {
    return priceCache;
  }

  const results = {};

  for (const sym of symbols) {
    if (sym === "CASH") {
      results[sym] = 1;
      continue;
    }

    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`
    );
    const data = await res.json();
    results[sym] = data.c;
  }

  priceCache = results;
  lastFetch = now;
  return results;
}

  
// 3. Login UI
function renderLogin(mode = "login") {
  const isCreate = mode === "create";

  app.innerHTML = `
    <div class="login-wrapper">
      <div class="login-card">
        <h2>Varsity Capital</h2>
        <p class="login-subtitle">
          ${isCreate ? "Create your account" : "Sign in to your dashboard"}
        </p>

        <div class="login-msg" id="loginMsg"></div>

        <input id="email" placeholder="Email" />
        <input id="password" type="password" placeholder="Password" />

        ${
          isCreate
            ? `<input id="password2" type="password" placeholder="Confirm password" />`
            : ""
        }

        <button id="primaryBtn">
          ${isCreate ? "Create account" : "Login"}
        </button>

        ${
          isCreate
            ? `<button class="link-btn" id="backBtn">Already have an account?</button>`
            : `
              <button class="link-btn" id="forgotBtn">Forgot password</button>
              <button class="link-btn" id="createBtn">Create account</button>
            `
        }
      </div>
    </div>
  `;

  const msg = (text, type = "info") => {
    const el = document.getElementById("loginMsg");
    el.textContent = text;
    el.className = `login-msg ${type}`;
  };

  const email = () => document.getElementById("email").value;
  const pass = () => document.getElementById("password").value;

  if (isCreate) {
    document.getElementById("primaryBtn").onclick = async () => {
      const p1 = pass();
      const p2 = document.getElementById("password2").value;

      if (p1 !== p2) {
        msg("Passwords do not match.", "error");
        return;
      }

      const { error } = await supa.auth.signUp({
        email: email(),
        password: p1
      });

      if (error) msg(error.message, "error");
      else msg("Account created. Check your email for confirmation", "success");
    };

    document.getElementById("backBtn").onclick = () => renderLogin("login");
  } else {
    document.getElementById("primaryBtn").onclick = async () => {
      const { error } = await supa.auth.signInWithPassword({
        email: email(),
        password: pass()
      });

      if (error) msg(error.message, "error");
      else init();
    };

    document.getElementById("forgotBtn").onclick = async () => {
      const e = email();
      if (!e) {
        msg("Enter your email first.", "error");
        return;
      }

      const { error } = await supa.auth.resetPasswordForEmail(e, {
        redirectTo: window.location.origin
      });

      if (error) msg(error.message, "error");
      else msg("Password reset email sent.", "success");
    };

    document.getElementById("createBtn").onclick = () => renderLogin("create");
  }
}


  
function renderLayout(label = "Your Account") {
    app.innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-header">
            <div class="logo">Varsity Capital</div>
          </div>
  
          <nav class="nav">
  <div class="nav-item active">Overview</div>

  <div class="nav-item disabled">
    Performance <span class="soon">Soon</span>
  </div>

  <div class="nav-item disabled">
    Holdings <span class="soon">Soon</span>
  </div>

  <div class="nav-item disabled">
    Fund Structure <span class="soon">Soon</span>
  </div>

  <div class="nav-item disabled">
    Your Account <span class="soon">Soon</span>
  </div>
</nav>

  
          <div class="sidebar-footer">
            ${label}
          </div>
        </aside>
  
        <main class="main" id="main"></main>
      </div>
    `;
  }
  

// 4. Dashboard UI

async function renderDashboard() {
  app.innerHTML = `
  <div class="loading-screen">
    <div class="loading-card">
      <div class="spinner"></div>
      <div class="loading-text">Loading fund data…</div>
    </div>
  </div>
`;

  const { data: { user } } = await supa.auth.getUser();

  if (!user) {
    // Session is gone or invalid — go back to login
    renderLogin();
    return;
  }

  
    const { data: accounts, error: accErr } = await supa
      .from("accounts")
      .select("*");
  
    const { data: holdings, error: holdErr } = await supa
      .from("holdings")
      .select("*");
  
    if (accErr || holdErr) {
      app.innerHTML = `<p>Error loading data</p>`;
      return;
    }
  
    const myAccount = accounts.find(a => a.owner_user_id === user.id);

if (!myAccount) {
  app.innerHTML = `
    <div class="login-wrapper">
      <div class="login-card">
        <h2>Account not linked</h2>
        <p class="login-subtitle">
          Your login exists, but you have not been assigned an account yet.
        </p>
        <p style="font-size:13px;color:#64748b">
          Please contact the fund administrator.
        </p>
        <button id="logoutBtn">Sign out</button>
      </div>
    </div>
  `;

  document.getElementById("logoutBtn").onclick = async () => {
    await supa.auth.signOut();
    init();
  };

  return;
}

const displayName = myAccount.name || "Your Account";

  
    renderLayout(displayName);
  
    const main = document.getElementById("main");
    main.innerHTML = `
      <div class="overview">
        <div class="top-row">
          <div class="card summary-card" id="summary"></div>
            <div class="card chart-card">
        <h3>Sector Allocation</h3>
        <canvas id="sectorChart"></canvas>
      </div>
        </div>
  
        <div class="card holdings-card" id="holdings">Holdings card</div>
        <div class="card accounts-card" id="accounts">Accounts</div>
      </div>
    `;
  
    // ---- LIVE PRICE PIPELINE ----
    const symbols = [...new Set(holdings.map(h => h.symbol))];
    const prices = await fetchPrices(symbols);

  
    const enrichedHoldings = holdings.map(h => {
      const price = prices[h.symbol] ?? 0;
      const marketValue = Number(h.shares) * price;
      const costValue = Number(h.shares) * Number(h.cost_basis);
      const pnl = marketValue - costValue;
  
      return {
        ...h,
        price,
        marketValue,
        costValue,
        pnl
      };
    });
  
    const fundValue = enrichedHoldings.reduce(
      (s, h) => s + h.marketValue,
      0
    );
  
    const totalUnits = accounts.reduce(
      (s, a) => s + Number(a.units),
      0
    );
  
    const nav = fundValue / totalUnits;
    const myBalance = myAccount.units * nav;
  
    document.getElementById("summary").innerHTML = `
      <h3>Your Account</h3>
      <p><strong>${displayName}</strong></p>
      <p>Units: ${Number(myAccount.units).toFixed(2)}</p>
      <p>Balance: $${myBalance.toFixed(2)}</p>
  
      <hr />
  
      <h3>Fund</h3>
      <p>Total Value: $${fundValue.toFixed(2)}</p>
      <p>Total Units: ${totalUnits.toFixed(2)}</p>
      <p>NAV: $${nav.toFixed(2)}</p>
    `;
// Holdings table
    const holdingsRows = enrichedHoldings
  .map(h => `
    <tr>
      <td>${h.symbol}</td>
      <td>${h.shares}</td>
      <td>$${Number(h.cost_basis).toFixed(2)}</td>
      <td>$${h.price.toFixed(2)}</td>
      <td>$${h.marketValue.toFixed(2)}</td>
      <td style="color:${h.pnl >= 0 ? "green" : "red"}">
        ${h.pnl >= 0 ? "+" : ""}$${h.pnl.toFixed(2)}
      </td>
    </tr>
  `)
  .join("");

document.getElementById("holdings").innerHTML = `
  <h3>Holdings</h3>
  <table>
    <tr>
      <th>Symbol</th>
      <th>Shares</th>
      <th>Cost</th>
      <th>Price</th>
      <th>Value</th>
      <th>P/L</th>
    </tr>
    ${holdingsRows}
  </table>
`;
//Accounts Table
const accountsWithBalances = accounts.map(a => {
    const balance = Number(a.units) * nav;
    const pct = balance / fundValue;
    return { ...a, balance, pct };
  });
  
  accountsWithBalances.sort((a, b) => b.balance - a.balance);
  
  const accountRows = accountsWithBalances
    .map((a, i) => {
      const label = `Account ${String.fromCharCode(65 + i)}`; // A, B, C, ...
      return `
        <tr>
          <td>${label}</td>
          <td>${a.units}</td>
          <td>$${a.balance.toFixed(2)}</td>
          <td>${(a.pct * 100).toFixed(2)}%</td>
        </tr>
      `;
    })
    .join("");
  
  document.getElementById("accounts").innerHTML = `
    <h3>Accounts</h3>
    <table>
      <tr>
        <th>Account</th>
        <th>Units</th>
        <th>Balance</th>
        <th>% of Fund</th>
      </tr>
      ${accountRows}
    </table>
  `;
  const sectorTotals = {};

for (const h of enrichedHoldings) {
  sectorTotals[h.sector] =
    (sectorTotals[h.sector] || 0) + h.marketValue;
}



const labels = Object.keys(sectorTotals);
const values = Object.values(sectorTotals);

const ctx = document.getElementById("sectorChart").getContext("2d");

new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: [
            "#002952",
            "#1f4e79",
            "#4a90e2",
            "#7fb3ff",
            "#cfe3ff",
            "#9bbad9"
          ]
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom"
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const value = context.raw;
              const pct = (value / total) * 100;
              return `${context.label}: ${pct.toFixed(2)}%`;
            }
          }
        }
      }
    }
  });
}

setTimeout(init, 120000); // re-run auth gate + refresh
