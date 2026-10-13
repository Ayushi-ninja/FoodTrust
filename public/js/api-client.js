/**
 * public/js/api-client.js
 * FoodTrust — Frontend API Client (Phase 11)
 *
 * Lightweight, robust fetch client for connecting static frontend views
 * to the Next.js API endpoints.
 *
 * ARCHITECTURAL CONTRACT:
 * - Credentials: uses standard `credentials: 'include'` for secure cookie sessions.
 * - Error Handling: parses standardized { success, data, message, error } envelopes.
 * - Idempotency: prevents concurrent double-submissions via in-flight request tracking.
 * - Role Resolution: reads verified user profile and role from /api/auth/me.
 * - Sensitive Data: NEVER stores passwords, OTPs, or service-role keys in localStorage.
 */

(function (window) {
  'use strict';

  const API_BASE = ''; // Same origin Next.js API
  const inFlightRequests = new Set();

  class ApiError extends Error {
    constructor(message, status, details) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.details = details;
    }
  }

  async function request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const method = (options.method || 'GET').toUpperCase();
    const requestId = `${method}:${url}`;

    // Prevent duplicate in-flight mutations
    if (method !== 'GET' && inFlightRequests.has(requestId)) {
      throw new ApiError('A request is already in progress. Please wait.', 429, null);
    }

    if (method !== 'GET') {
      inFlightRequests.add(requestId);
    }

    try {
      const headers = {
        'Accept': 'application/json',
        ...(options.headers || {}),
      };

      if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Transmit HTTP-only Supabase auth cookies
      });

      let json = null;
      try {
        json = await response.json();
      } catch (err) {
        // Not a JSON response
      }

      if (!response.ok) {
        const errorMsg = json?.message || json?.error || `Request failed with status ${response.status}`;
        throw new ApiError(errorMsg, response.status, json?.error || json);
      }

      return json?.data !== undefined ? json.data : json;
    } finally {
      if (method !== 'GET') {
        inFlightRequests.delete(requestId);
      }
    }
  }

  // --- Auth & Session API ---
  const auth = {
    async login(email, password) {
      return request('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
    },

    async register(email, password, fullName, role) {
      return request('/api/auth/register', {
        method: 'POST',
        body: { email, password, fullName, role },
      });
    },

    async me() {
      try {
        return await request('/api/auth/me', { method: 'GET' });
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          return null; // Graceful unauthenticated
        }
        throw err;
      }
    },

    async logout() {
      try {
        await request('/api/auth/logout', { method: 'POST' });
      } finally {
        sessionStorage.removeItem('foodtrust_user');
      }
    },
  };

  // --- Donations API ---
  const donations = {
    async list(params = {}) {
      const qs = new URLSearchParams(params).toString();
      return request(`/api/donations${qs ? '?' + qs : ''}`);
    },

    async getById(id) {
      return request(`/api/donations/${encodeURIComponent(id)}`);
    },

    async create(donationData) {
      return request('/api/donations', {
        method: 'POST',
        body: donationData,
      });
    },

    async cancel(id, reason) {
      return request(`/api/donations/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        body: { reason },
      });
    },

    async evaluateFreshness(payload) {
      return request('/api/freshness/evaluate', {
        method: 'POST',
        body: payload,
      });
    },
  };

  // --- NGO Matching & Claims API ---
  const claims = {
    async claim(donationId, notes) {
      return request(`/api/donations/${encodeURIComponent(donationId)}/claim`, {
        method: 'POST',
        body: { notes: notes || 'NGO Claim via Portal' },
      });
    },

    async list(params = {}) {
      const qs = new URLSearchParams(params).toString();
      return request(`/api/claims${qs ? '?' + qs : ''}`);
    },

    async matchNgos(donationId, radiusKm = 20) {
      return request(`/api/matching/ngos?donationId=${encodeURIComponent(donationId)}&radiusKm=${radiusKm}`);
    },
  };

  // --- Pickups & OTP API ---
  const pickups = {
    async create(donationId, assignedVolunteer, volunteerPhone) {
      return request('/api/pickups', {
        method: 'POST',
        body: { donationId, assignedVolunteer, volunteerPhone },
      });
    },

    async getOtp(pickupId) {
      return request(`/api/pickups/${encodeURIComponent(pickupId)}/generate-otp`, {
        method: 'POST',
      });
    },

    async verifyOtp(pickupId, otpCode) {
      return request(`/api/pickups/${encodeURIComponent(pickupId)}/verify-otp`, {
        method: 'POST',
        body: { otpCode },
      });
    },

    async completeDelivery(pickupId, proofImageUrl) {
      return request(`/api/pickups/${encodeURIComponent(pickupId)}/complete`, {
        method: 'POST',
        body: { proofImageUrl },
      });
    },
  };

  // --- Analytics API ---
  const analytics = {
    async overview() {
      return request('/api/analytics/overview');
    },

    async donor() {
      return request('/api/analytics/donor');
    },

    async ngo() {
      return request('/api/analytics/ngo');
    },

    async admin() {
      return request('/api/analytics/admin');
    },
  };

  // --- Notifications API ---
  const notifications = {
    async list(params = {}) {
      const qs = new URLSearchParams(params).toString();
      return request(`/api/notifications${qs ? '?' + qs : ''}`);
    },

    async markRead(id) {
      return request(`/api/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
      });
    },
  };

  // --- Admin API ---
  const admin = {
    async listUsers(params = {}) {
      const qs = new URLSearchParams(params).toString();
      return request(`/api/admin/users${qs ? '?' + qs : ''}`);
    },

    async updateUser(id, updateData) {
      return request(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: updateData,
      });
    },

    async listLogs(params = {}) {
      const qs = new URLSearchParams(params).toString();
      return request(`/api/admin/logs${qs ? '?' + qs : ''}`);
    },

    async getConfig() {
      return request('/api/admin/config');
    },

    async updateConfig(key, value) {
      return request('/api/admin/config', {
        method: 'PATCH',
        body: { key, value },
      });
    },
  };

  // Expose global client
  window.FoodTrustAPI = {
    auth,
    donations,
    claims,
    pickups,
    analytics,
    notifications,
    admin,
    ApiError,
  };

})(typeof window !== 'undefined' ? window : this);
