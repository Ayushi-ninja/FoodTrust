# 🍱 FoodTrust (KindBite) - Food Donation & Redistribution Platform

A responsive web application designed to streamline the donation, tracking, and redistribution of surplus food between donors (restaurants, banquet halls, caterers) and NGOs, supported by AI-driven freshness scoring and admin oversight.

This project addresses urban food waste and hunger by connecting surplus food with local communities in need across Delhi NCR.

---

## 🚀 Key Modules & Features

- **🏢 Donor Portal (`donor-dashboard.html`)**
  - Interactive donation submission form (food type, quantity in kg, expiration timeline).
  - Dynamic AI Freshness prediction & estimated shelf-life generation.
  - Category distribution breakdown (interactive doughnut chart via Chart.js).
  - Persistent donation history table using `localStorage`.

- **🤝 NGO / Nearby Donations Map (`nearby-donations.html`)**
  - Interactive Leaflet.js map with OpenStreetMap tiles geocoded across Delhi NCR.
  - Dynamic donation pins with color-coded freshness indicators (Fresh / Moderate / Critical).
  - Search by keyword and filter by food category (Cooked Meals, Vegetables, Fruits, Bakery).
  - One-click "Claim Donation" action that updates donation status across the platform.
  - AI Freshness Explanatory Modal popup.

- **🛡 Admin Dashboard (`admin-dashboard.html`)**
  - System performance KPIs (Total Donations, Claimed Donations, Registered NGOs, Active Donors).
  - Real-time line and bar charts (Chart.js) showing monthly donation volume and kilograms saved.
  - User management table with interactive delete and account block/unblock actions.
  - Dedicated admin navigation sidebar.

- **🤖 AI Insights (`ai-insights.html`)**
  - Explanations of the AI Freshness prediction algorithms, urgency detection, and smart NGO matching.

- **🌟 Community & Informational Pages**
  - Home landing page (`index.html`) with hero section, how-it-works workflow, and testimonials.
  - Our Mission (`our-mission.html`) & About Us (`about-us.html`).
  - Live Impact Counters (`impact-testimonials.html`) with animated counting metrics.
  - Contact Us (`contact-us.html`) & Multi-role Login/Registration Portal (`login.html`).

---

## 🧩 Tech Stack

| Technology | Purpose |
| :--- | :--- |
| **HTML5** | Semantic markup across 10 distinct platform views |
| **Custom CSS** | Modern responsive styles, unified sticky navbar, CSS Grid & Flexbox (`CSS/style.css`) |
| **Vanilla JavaScript** | Modular, defensive client-side scripting (`js/script.js`) |
| **Leaflet.js & OpenStreetMap** | Real-time map rendering and geocoded pickup markers |
| **Chart.js** | Data visualization for donor statistics and admin KPI trends |
| **FontAwesome 6.x** | Consistent iconography across views and dashboards |
| **LocalStorage** | Client-side persistence for seamless demo data synchronization |

---

## 📁 Project Directory Structure

```
FoodTrust/
├── assets/
│   └── logo2.png                 # Platform logo brand asset
├── CSS/
│   └── style.css                 # Master stylesheet with responsive layouts
├── js/
│   └── script.js                 # Global application logic (Leaflet, Chart.js, LocalStorage)
├── index.html                    # Homepage & platform overview
├── donor-dashboard.html          # Donor submission portal & history
├── nearby-donations.html         # Interactive map view for NGOs
├── admin-dashboard.html          # Admin analytics panel & user management
├── ai-insights.html              # AI Freshness scoring & algorithm overview
├── impact-testimonials.html      # Community impact metrics & stories
├── our-mission.html              # Organization mission & vision
├── about-us.html                 # Team background & motivation
├── contact-us.html               # Contact form & HQ information
├── login.html                    # Unified Donor/NGO/Admin authentication portal
└── README.md                     # Project documentation
```

---

## 💻 How to Run

Because this project is built with standard web technologies, no heavy build steps or compilation are required!

### Option 1: Direct Browser Access
Simply double-click `index.html` or right-click and choose **Open with Browser** (Chrome, Edge, Firefox).

### Option 2: Local HTTP Server (Recommended)
Using Python:
```bash
# Python 3.x
python -m http.server 8000
```
Or using Node.js:
```bash
npx serve .
```
Then visit: `http://localhost:8000` (or the port specified).

---

## 🔮 Future Enhancements
- [ ] Backend API using Python (Django REST Framework / FastAPI) or Node.js (Express).
- [ ] Database integration (PostgreSQL / MongoDB) replacing `localStorage`.
- [ ] IoT sensor hardware integration (temperature, humidity, and VOC sensors for real-time freshness telemetry).
- [ ] Real-time push notifications via WebSockets when surplus food is posted nearby.
- [ ] Automated routing and route optimization for NGO volunteer pickup vehicles.
