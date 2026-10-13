/**
 * FoodTrust / KindBite - Core Interactive Platform Logic
 * Handles Leaflet Maps, Chart.js visualizations, LocalStorage persistence,
 * and AI Freshness scoring simulation.
 */

// --- LocalStorage Store ---
const STORAGE_KEY = 'foodtrust_donations';

const DEFAULT_DONATIONS = [
  {
    id: 1,
    foodType: 'Cooked Meals',
    quantity: 25,
    freshness: 'Fresh',
    freshnessScore: 94,
    shelfLife: '5 hrs',
    status: 'Available',
    coords: [28.6139, 77.2090],
    locationName: 'Connaught Place, New Delhi',
    expiry: new Date(Date.now() + 5 * 3600000).toISOString(),
    donorName: 'Spice Route Bistro'
  },
  {
    id: 2,
    foodType: 'Vegetables',
    quantity: 40,
    freshness: 'Moderate',
    freshnessScore: 78,
    shelfLife: '14 hrs',
    status: 'Available',
    coords: [28.6304, 77.2177],
    locationName: 'Karol Bagh Market, New Delhi',
    expiry: new Date(Date.now() + 14 * 3600000).toISOString(),
    donorName: 'Fresh Mart Delhi'
  },
  {
    id: 3,
    foodType: 'Fruits',
    quantity: 18,
    freshness: 'Fresh',
    freshnessScore: 90,
    shelfLife: '24 hrs',
    status: 'Available',
    coords: [28.5355, 77.2410],
    locationName: 'Saket City Mall, South Delhi',
    expiry: new Date(Date.now() + 24 * 3600000).toISOString(),
    donorName: 'Organic Greens Co.'
  },
  {
    id: 4,
    foodType: 'Bakery & Bread',
    quantity: 15,
    freshness: 'Low',
    freshnessScore: 48,
    shelfLife: '3 hrs',
    status: 'Available',
    coords: [28.6505, 77.2303],
    locationName: 'Chandni Chowk, Old Delhi',
    expiry: new Date(Date.now() + 3 * 3600000).toISOString(),
    donorName: 'Old Delhi Bakeries'
  }
];

function getDonations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_DONATIONS));
      return DEFAULT_DONATIONS;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading localStorage:', err);
    return DEFAULT_DONATIONS;
  }
}

function saveDonations(donations) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(donations));
  } catch (err) {
    console.error('Error saving to localStorage:', err);
  }
}

function calculateAIScore(expiryDateString) {
  const now = Date.now();
  const expiry = new Date(expiryDateString).getTime();
  const diffHours = (expiry - now) / 3600000;

  if (diffHours <= 0) {
    return { score: 15, label: 'Expired', shelfLife: 'Expired' };
  } else if (diffHours < 4) {
    return { score: Math.round(35 + diffHours * 10), label: 'Low', shelfLife: `${Math.round(diffHours)} hrs` };
  } else if (diffHours < 12) {
    return { score: Math.round(70 + (diffHours - 4) * 2), label: 'Moderate', shelfLife: `${Math.round(diffHours)} hrs` };
  } else {
    return { score: Math.min(98, Math.round(85 + (diffHours - 12))), label: 'Fresh', shelfLife: `${Math.round(diffHours)} hrs` };
  }
}

// --- Active Nav Link Highlighting ---
function highlightActiveNav() {
  const currentPath = window.location.pathname;
  const fileName = currentPath.substring(currentPath.lastIndexOf('/') + 1) || 'index.html';
  
  const navLinks = document.querySelectorAll('.nav-links a');
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === fileName || (fileName === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  const sidebarLinks = document.querySelectorAll('.sidebar li a');
  sidebarLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === fileName) {
      link.parentElement.classList.add('active');
    } else {
      link.parentElement.classList.remove('active');
    }
  });
}

// --- Leaflet Map Module (for nearby-donations.html) ---
let leafletMapInstance = null;
let currentMarkers = [];

async function initNearbyDonationsMap() {
  const mapContainer = document.getElementById('map');
  if (!mapContainer || typeof L === 'undefined') return;

  // Prevent duplicate initialization
  if (leafletMapInstance) {
    leafletMapInstance.remove();
    leafletMapInstance = null;
  }

  // Centered on Delhi
  leafletMapInstance = L.map('map').setView([28.6139, 77.2090], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(leafletMapInstance);

  const donationList = document.getElementById('donationList');
  const typeFilter = document.getElementById('typeFilter') || document.getElementById('foodTypeFilter');
  const searchBar = document.getElementById('searchBar');
  const freshnessFilter = document.getElementById('freshnessFilter');

  async function fetchRealOrLocalDonations() {
    if (window.FoodTrustAPI && window.FoodTrustAPI.donations) {
      try {
        const apiDonations = await window.FoodTrustAPI.donations.list({ limit: 50 });
        if (Array.isArray(apiDonations) && apiDonations.length > 0) {
          // Normalize backend rows into map view structure
          return apiDonations.map(d => ({
            id: d.id,
            foodType: d.title || d.food_category,
            quantity: d.quantity_kg,
            freshness: d.freshness_status === 'FRESH' ? 'Fresh' : (d.freshness_status === 'MODERATE' ? 'Moderate' : 'Critical'),
            freshnessScore: d.freshness_score || 85,
            shelfLife: `${d.shelf_life_hours_remaining || 12} hrs`,
            status: d.status === 'AVAILABLE' ? 'Available' : 'Claimed',
            coords: [d.latitude || 28.6139, d.longitude || 77.2090],
            locationName: d.pickup_address || 'Delhi NCR',
            donorName: 'Verified Donor'
          }));
        }
      } catch (err) {
        console.warn('Backend API list fallback to local storage:', err);
      }
    }
    return getDonations();
  }

  async function renderMapData() {
    const donations = await fetchRealOrLocalDonations();
    const selectedType = typeFilter ? typeFilter.value.toLowerCase() : 'all';
    const selectedFresh = freshnessFilter ? freshnessFilter.value.toLowerCase() : 'all';
    const keyword = searchBar ? searchBar.value.toLowerCase().trim() : '';

    // Clear existing markers
    currentMarkers.forEach(marker => leafletMapInstance.removeLayer(marker));
    currentMarkers = [];

    if (donationList) donationList.innerHTML = '';

    const filtered = donations.filter(d => {
      const matchType = selectedType === 'all' || selectedType === '' || d.foodType.toLowerCase().includes(selectedType);
      const matchFresh = selectedFresh === 'all' || selectedFresh === '' || d.freshness.toLowerCase() === selectedFresh;
      const matchText = !keyword || 
        d.foodType.toLowerCase().includes(keyword) || 
        (d.locationName && d.locationName.toLowerCase().includes(keyword)) ||
        d.freshness.toLowerCase().includes(keyword);
      return matchType && matchFresh && matchText;
    });

    if (filtered.length === 0 && donationList) {
      donationList.innerHTML = `<div style="padding:20px; text-align:center; color:#777;">No active food donations found matching your filters.</div>`;
      return;
    }

    filtered.forEach(d => {
      // Add Map Marker
      const coords = d.coords || [28.6139, 77.2090];
      const marker = L.marker(coords).addTo(leafletMapInstance);
      const popupContent = `
        <div style="font-family: sans-serif; line-height: 1.4;">
          <h4 style="margin:0 0 4px 0; color:#b30000;">${d.foodType}</h4>
          <b>Quantity:</b> ${d.quantity} kg<br/>
          <b>Freshness:</b> <span style="color:${d.freshnessScore >= 70 ? 'green' : (d.freshnessScore >= 50 ? 'orange' : 'red')}">${d.freshness} (${d.freshnessScore}/100)</span><br/>
          <b>Shelf Life:</b> ${d.shelfLife}<br/>
          <b>Status:</b> ${d.status || 'Available'}
        </div>
      `;
      marker.bindPopup(popupContent);
      currentMarkers.push(marker);

      // Add List Card
      if (donationList) {
        const isClaimed = d.status === 'Claimed' || d.status === 'CLAIMED';
        const card = document.createElement('div');
        card.className = 'donation-card';
        card.style.opacity = isClaimed ? '0.6' : '1';
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <h3>${d.foodType}</h3>
            <span class="badge ${d.freshness === 'Low' || d.freshness === 'Critical' ? 'alert' : 'new'}" style="padding:2px 8px; font-size:0.8rem; border-radius:4px; background:${d.freshnessScore >= 70 ? '#16a34a' : (d.freshnessScore >= 50 ? '#f59e0b' : '#dc2626')}; color:white;">
              ${d.freshness}
            </span>
          </div>
          <p><strong>Quantity:</strong> ${d.quantity} kg</p>
          <p><strong>Location:</strong> ${d.locationName || 'Delhi'}</p>
          <p><strong>AI Freshness Score:</strong> <strong class="freshness-link" onclick="openFreshnessModal()">${d.freshnessScore}/100</strong></p>
          <p><strong>Est. Shelf Life:</strong> ${d.shelfLife}</p>
          <div style="margin-top:10px;">
            ${isClaimed 
              ? `<span style="display:inline-block; padding:6px 12px; background:#6b7280; color:white; border-radius:4px; font-weight:600;">Claimed by NGO</span>`
              : `<button onclick="claimDonation('${d.id}')" style="background:#b30000; color:white; border:none; padding:8px 14px; border-radius:4px; cursor:pointer;">Claim Donation</button>`
            }
          </div>
        `;
        donationList.appendChild(card);
      }
    });
  }

  if (typeFilter) typeFilter.addEventListener('change', renderMapData);
  if (freshnessFilter) freshnessFilter.addEventListener('change', renderMapData);
  if (searchBar) searchBar.addEventListener('input', renderMapData);

  await renderMapData();
}

window.claimDonation = async function(id) {
  if (window.FoodTrustAPI && window.FoodTrustAPI.claims && typeof id === 'string' && id.includes('-')) {
    // Real UUID - attempt backend claim
    if (confirm(`Confirm claiming this donation for your verified NGO?`)) {
      try {
        await window.FoodTrustAPI.claims.claim(id, 'NGO claim submitted from interactive food map');
        alert(`Success! Donation has been claimed. Proceed to pickup scheduling.`);
        initNearbyDonationsMap();
        return;
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          alert('Authentication Required: Please login as a verified NGO to claim this donation.');
          window.location.href = 'login.html';
          return;
        }
        alert('Could not claim donation: ' + (err.message || 'Please try again.'));
        return;
      }
    }
    return;
  }

  // Fallback for local prototype records
  const donations = getDonations();
  const item = donations.find(d => String(d.id) === String(id));
  if (!item) return;

  if (item.status === 'Claimed') {
    alert('This donation has already been claimed!');
    return;
  }

  if (confirm(`Confirm claiming ${item.quantity} kg of "${item.foodType}" for your NGO?`)) {
    item.status = 'Claimed';
    saveDonations(donations);
    alert(`Success! You have claimed donation #${id} (${item.foodType}). Pickup details sent.`);
    initNearbyDonationsMap();
  }
};

window.openFreshnessModal = function() {
  const modal = document.getElementById('modal');
  if (modal) modal.style.display = 'block';
};

window.closeFreshnessModal = function() {
  const modal = document.getElementById('modal');
  if (modal) modal.style.display = 'none';
};

// --- Donor Dashboard Module ---
function initDonorDashboard() {
  const form = document.getElementById('donationForm');
  const historyTable = document.getElementById('historyTable');
  const donationCount = document.getElementById('donationCount');
  const successMessage = document.getElementById('successMessage');

  if (!form && !historyTable) return;

  async function renderHistory() {
    let donationsList = [];

    // Attempt to read from backend
    if (window.FoodTrustAPI && window.FoodTrustAPI.donations) {
      try {
        const apiDonations = await window.FoodTrustAPI.donations.list({ limit: 50 });
        if (Array.isArray(apiDonations) && apiDonations.length > 0) {
          donationsList = apiDonations.map(d => ({
            id: d.id,
            foodType: d.title || d.food_category,
            quantity: d.quantity_kg,
            expiry: d.preparation_timestamp,
            status: d.status
          }));
        }
      } catch (err) {
        console.warn('Backend list failed, using local storage:', err);
      }
    }

    if (donationsList.length === 0) {
      donationsList = getDonations();
    }

    if (donationCount) {
      donationCount.textContent = donationsList.length;
    }

    if (historyTable) {
      historyTable.innerHTML = '';
      if (donationsList.length === 0) {
        historyTable.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:15px; color:#888;">No donations recorded yet.</td></tr>`;
        return;
      }

      donationsList.forEach(item => {
        const row = document.createElement('tr');
        const expiryFormatted = item.expiry ? new Date(item.expiry).toLocaleString() : 'N/A';
        const isClaimed = item.status === 'Claimed' || item.status === 'CLAIMED' || item.status === 'PICKUP_IN_PROGRESS';
        const statusClass = isClaimed ? 'picked' : 'approved';
        row.innerHTML = `
          <td><strong>${item.foodType}</strong></td>
          <td>${item.quantity} kg</td>
          <td>${expiryFormatted}</td>
          <td><span class="status ${statusClass}">${item.status || 'Available'}</span></td>
        `;
        historyTable.appendChild(row);
      });
    }
  }

  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const foodType = document.getElementById('foodType').value.trim();
      const quantity = parseFloat(document.getElementById('quantity').value);
      const expiry = document.getElementById('expiry').value;

      if (!foodType || isNaN(quantity) || !expiry) {
        alert('Please fill out all required fields.');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
      }

      try {
        // Attempt backend creation
        if (window.FoodTrustAPI && window.FoodTrustAPI.donations) {
          try {
            await window.FoodTrustAPI.donations.create({
              title: foodType,
              description: `Surplus donation: ${quantity}kg ${foodType}`,
              foodCategory: 'COOKED_MEALS',
              quantityKg: quantity,
              preparationTimestamp: new Date(expiry).toISOString(),
              pickupAddress: 'Connaught Place, New Delhi',
              latitude: 28.6315,
              longitude: 77.2167,
            });

            form.reset();
            if (successMessage) {
              successMessage.classList.remove('hidden');
              successMessage.style.display = 'block';
              setTimeout(() => {
                successMessage.classList.add('hidden');
                successMessage.style.display = 'none';
              }, 3500);
            }
            await renderHistory();
            return;
          } catch (err) {
            if (err.status === 401 || err.status === 403) {
              alert('Authentication Required: Please login as a registered Donor to create real donations.');
              window.location.href = 'login.html';
              return;
            }
            console.warn('Backend donation creation failed, saving locally:', err);
          }
        }

        // Local storage demo fallback
        const aiAnalysis = calculateAIScore(expiry);
        const latOffset = (Math.random() - 0.5) * 0.08;
        const lngOffset = (Math.random() - 0.5) * 0.08;

        const newDonation = {
          id: Date.now(),
          foodType: foodType,
          quantity: quantity,
          freshness: aiAnalysis.label,
          freshnessScore: aiAnalysis.score,
          shelfLife: aiAnalysis.shelfLife,
          status: 'Available',
          coords: [28.6139 + latOffset, 77.2090 + lngOffset],
          locationName: 'Delhi NCR (Donor Pickup Point)',
          expiry: expiry,
          donorName: 'Anonymous Donor'
        };

        const donations = getDonations();
        donations.unshift(newDonation);
        saveDonations(donations);

        if (successMessage) {
          successMessage.classList.remove('hidden');
          successMessage.style.display = 'block';
          setTimeout(() => {
            successMessage.classList.add('hidden');
            successMessage.style.display = 'none';
          }, 3500);
        }

        form.reset();
        await renderHistory();
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Donation';
        }
      }
    });
  }

  // Filter history
  const historySearch = document.getElementById('searchBar');
  if (historySearch && historyTable) {
    historySearch.addEventListener('input', function() {
      const q = this.value.toLowerCase().trim();
      const rows = historyTable.querySelectorAll('tr');
      rows.forEach(r => {
        r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  renderHistory();

  // Donor Chart
  const donorCanvas = document.getElementById('donationChart');
  if (donorCanvas && typeof Chart !== 'undefined') {
    const donations = getDonations();
    const categories = {};
    donations.forEach(d => {
      categories[d.foodType] = (categories[d.foodType] || 0) + d.quantity;
    });

    const labels = Object.keys(categories).length > 0 ? Object.keys(categories) : ['Meals', 'Vegetables', 'Fruits', 'Bakery'];
    const dataValues = Object.keys(categories).length > 0 ? Object.values(categories) : [30, 20, 15, 10];

    new Chart(donorCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: dataValues,
          backgroundColor: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'],
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  }
}

// --- Admin Dashboard Module ---
async function initAdminDashboard() {
  const trendCanvas = document.getElementById('donationTrendChart');
  const wasteCanvas = document.getElementById('wasteReductionChart');
  if (!trendCanvas && !wasteCanvas && !document.querySelector('.admin-dashboard')) return;

  // Attempt to load real overview analytics
  if (window.FoodTrustAPI && window.FoodTrustAPI.analytics) {
    try {
      const overview = await window.FoodTrustAPI.analytics.overview();
      if (overview) {
        const cards = document.querySelectorAll('.metrics .card p');
        if (cards.length >= 4) {
          cards[0].textContent = overview.donations?.total ?? 0;
          cards[1].textContent = overview.donations?.delivered ?? 0;
          cards[2].textContent = overview.users?.ngos ?? 0;
          cards[3].textContent = overview.users?.donors ?? 0;
        }
      }
    } catch (err) {
      console.warn('Admin analytics API fallback to demo KPIs:', err);
    }
  }

  // Attempt to load real users table
  const userTableBody = document.querySelector('.user-management table tbody');
  if (userTableBody && window.FoodTrustAPI && window.FoodTrustAPI.admin) {
    try {
      const userRes = await window.FoodTrustAPI.admin.listUsers({ limit: 10 });
      if (userRes && Array.isArray(userRes.users) && userRes.users.length > 0) {
        userTableBody.innerHTML = '';
        userRes.users.forEach(u => {
          const row = document.createElement('tr');
          const isSuspended = u.status === 'SUSPENDED';
          row.innerHTML = `
            <td><strong>${u.full_name || 'User'}</strong></td>
            <td>${u.role}</td>
            <td>${u.email}</td>
            <td style="color:${isSuspended ? 'red' : 'green'}; font-weight:600;">${u.status}</td>
            <td>
              <button data-id="${u.id}" data-status="${u.status}" style="background:${isSuspended ? '#22c55e' : '#dc2626'}; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer;">
                ${isSuspended ? 'Unblock' : 'Block'}
              </button>
            </td>
          `;
          userTableBody.appendChild(row);
        });
      }
    } catch (err) {
      console.warn('Admin users API fallback to demo table:', err);
    }
  }

  if (typeof Chart !== 'undefined') {
    if (trendCanvas) {
      new Chart(trendCanvas, {
        type: 'line',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [{
            label: 'Monthly Donations (Count)',
            data: [45, 68, 80, 110, 145, 180],
            backgroundColor: 'rgba(179, 0, 0, 0.1)',
            borderColor: '#b30000',
            borderWidth: 2,
            tension: 0.35,
            fill: true
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: true } }
        }
      });
    }

    if (wasteCanvas) {
      new Chart(wasteCanvas, {
        type: 'bar',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [{
            label: 'Surplus Food Saved (Kg)',
            data: [120, 180, 240, 310, 420, 560],
            backgroundColor: '#b30000',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: true } }
        }
      });
    }
  }

  // Interactive user management buttons
  const userTable = document.querySelector('.user-management table');
  if (userTable) {
    userTable.addEventListener('click', async function(e) {
      if (e.target.tagName === 'BUTTON') {
        const btn = e.target;
        const userId = btn.getAttribute('data-id');
        const currentStatus = btn.getAttribute('data-status');

        if (userId && window.FoodTrustAPI && window.FoodTrustAPI.admin) {
          const newStatus = currentStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
          try {
            btn.disabled = true;
            await window.FoodTrustAPI.admin.updateUser(userId, { status: newStatus });
            alert(`User status updated to ${newStatus}`);
            await initAdminDashboard();
            return;
          } catch (err) {
            alert('Admin action failed: ' + (err.message || 'Permission denied.'));
            return;
          } finally {
            btn.disabled = false;
          }
        }

        // Prototype fallback
        const row = btn.closest('tr');
        const name = row.children[0].innerText;
        const statusCell = row.children[3];

        if (btn.textContent.trim().toLowerCase() === 'delete') {
          if (confirm(`Are you sure you want to remove user "${name}"?`)) {
            row.remove();
          }
        } else if (btn.textContent.trim().toLowerCase() === 'unblock') {
          statusCell.textContent = 'Active';
          statusCell.style.color = 'green';
          btn.textContent = 'Block';
          btn.style.background = '#eab300';
        } else if (btn.textContent.trim().toLowerCase() === 'block') {
          statusCell.textContent = 'Blocked';
          statusCell.style.color = 'red';
          btn.textContent = 'Unblock';
          btn.style.background = '#22c55e';
        }
      }
    });
  }
}

// --- Impact Page Animated Numbers ---
function initImpactCounters() {
  const mealsEl = document.getElementById('meals');
  const wasteEl = document.getElementById('waste');
  const ngosEl = document.getElementById('ngos');

  if (!mealsEl && !wasteEl && !ngosEl) return;

  function animateCounter(el, target, duration = 1500) {
    if (!el) return;
    let start = 0;
    const stepTime = 20;
    const steps = duration / stepTime;
    const increment = target / steps;

    const timer = setInterval(() => {
      start += increment;
      if (start >= target) {
        el.textContent = Math.round(target).toLocaleString() + '+';
        clearInterval(timer);
      } else {
        el.textContent = Math.round(start).toLocaleString();
      }
    }, stepTime);
  }

  const donations = getDonations();
  const extraKg = donations.reduce((sum, d) => sum + (d.quantity || 0), 0);

  animateCounter(mealsEl, 12500 + Math.round(extraKg * 2.5));
  animateCounter(wasteEl, 4800 + Math.round(extraKg));
  animateCounter(ngosEl, 48);
}

// --- Dynamic Session Navigation Helper ---
async function updateAuthNavState() {
  if (!window.FoodTrustAPI || !window.FoodTrustAPI.auth) return;
  try {
    const user = await window.FoodTrustAPI.auth.me();
    if (user) {
      const loginLinks = document.querySelectorAll('a[href="login.html"]');
      loginLinks.forEach(link => {
        link.textContent = `Logout (${user.role})`;
        link.onclick = async (e) => {
          e.preventDefault();
          if (confirm('Are you sure you want to log out?')) {
            await window.FoodTrustAPI.auth.logout();
            window.location.href = 'index.html';
          }
        };
      });
    }
  } catch (err) {
    // Session check non-blocking
  }
}

// --- Initialize Page Logic on DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', async function() {
  highlightActiveNav();
  await updateAuthNavState();
  initNearbyDonationsMap();
  initDonorDashboard();
  initAdminDashboard();
  initImpactCounters();

  // Modal close handlers
  const closeModalBtn = document.getElementById('closeModal');
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', window.closeFreshnessModal);
  }
  window.addEventListener('click', function(e) {
    const modal = document.getElementById('modal');
    if (e.target === modal) {
      window.closeFreshnessModal();
    }
  });

  // Loading spinner dismissal fallback
  const spinner = document.getElementById('loading-spinner');
  if (spinner) {
    spinner.style.display = 'none';
  }
});