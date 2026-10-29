/**
 * Hader-V2 Production API Client
 * Enterprise-grade Fetch wrapper with dynamic Fly.io production fallback,
 * Supabase token resolution, device hardware locking headers, and robust error handling.
 */

import { getDeviceFingerprint } from '../utils/deviceUtils.js';

// 1. Dynamic API Base URL Configuration with https://hader-websit.fly.dev fallback
const rawEnvUrl = (typeof import.meta !== 'undefined' && import.meta.env)
  ? import.meta.env.VITE_API_URL
  : (typeof process !== 'undefined' && process.env ? process.env.VITE_API_URL : undefined);

export const API_BASE_URL = (rawEnvUrl && typeof rawEnvUrl === 'string' && rawEnvUrl.trim() !== '')
  ? rawEnvUrl.trim().replace(/\/+$/, '')
  : 'https://hader-websit.fly.dev';

export const API_V1_URL = `${API_BASE_URL}/api/v1`;

// LocalStorage Keys
export const AUTH_TOKEN_KEY = 'hader_auth_token';
export const USER_STORAGE_KEY = 'hader_current_user';

/**
 * Retrieve authorization Bearer token from localStorage
 * Inspects:
 * 1. Direct hader_auth_token key
 * 2. Supabase session storage keys (sb-*-auth-token or supabase.auth.token)
 * 3. Token attached to hader_current_user profile
 */
export function getStoredAuthToken() {
  if (typeof window === 'undefined') return null;

  // 1. Primary hader auth token
  const direct = localStorage.getItem(AUTH_TOKEN_KEY);
  if (direct && direct.trim() !== '') return direct.trim();

  // 2. Supabase Client default storage inspection
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('supabase.auth.token'))) {
        const item = localStorage.getItem(key);
        if (item) {
          const parsed = JSON.parse(item);
          const token =
            parsed?.access_token ||
            parsed?.token ||
            parsed?.currentSession?.access_token ||
            parsed?.session?.access_token;
          if (token && typeof token === 'string') return token.trim();
        }
      }
    }
  } catch {
    // Ignore JSON parsing errors for unrelated keys
  }

  // 3. User object backup
  try {
    const userRaw = localStorage.getItem(USER_STORAGE_KEY);
    if (userRaw) {
      const user = JSON.parse(userRaw);
      if (user?.token) return user.token;
      if (user?.accessToken) return user.accessToken;
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Store the active JWT access token
 */
export function setStoredAuthToken(token) {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

/**
 * Custom API Error carrying status, error code, and server payload
 */
export class ApiError extends Error {
  constructor(message, status = 500, code = 'API_ERROR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Normalize requested path into fully-qualified URL targeting Fly.io host
 */
function resolveUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanPath.startsWith('/api/')) {
    return `${API_BASE_URL}${cleanPath}`;
  }
  return `${API_V1_URL}${cleanPath}`;
}

/**
 * Perform strongly-typed HTTP request with automatic headers and error normalization
 */
async function request(endpoint, options = {}) {
  const url = resolveUrl(endpoint);
  const {
    method = 'GET',
    headers = {},
    body,
    token: customToken,
    timeoutMs = 15000,
    credentials = 'include',
    ...restOptions
  } = options;

  // Resolve Device Hardware Fingerprint
  const device = getDeviceFingerprint();
  const deviceId = device?.deviceId || 'DEV-WEB-CLIENT';

  // Resolve Authorization Token
  const authToken = customToken !== undefined ? customToken : getStoredAuthToken();

  // Assemble Standard Production Headers
  const defaultHeaders = {
    'Accept': 'application/json',
    'X-Device-Id': deviceId
  };

  if (body !== undefined && !(body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (authToken) {
    defaultHeaders['Authorization'] = `Bearer ${authToken}`;
  }

  const mergedHeaders = {
    ...defaultHeaders,
    ...headers
  };

  // Timeout controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const fetchConfig = {
    method,
    headers: mergedHeaders,
    credentials,
    signal: controller.signal,
    ...restOptions
  };

  if (body !== undefined) {
    fetchConfig.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  try {
    const response = await fetch(url, fetchConfig);
    clearTimeout(timeoutId);

    // Parse Response (JSON or plain text)
    const contentType = response.headers.get('content-type') || '';
    let responseData = null;

    if (contentType.includes('application/json')) {
      try {
        responseData = await response.json();
      } catch {
        responseData = null;
      }
    } else {
      try {
        responseData = await response.text();
      } catch {
        responseData = null;
      }
    }

    // Handle Unsuccessful HTTP Statuses
    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`;
      let errorCode = 'HTTP_ERROR';

      if (responseData && typeof responseData === 'object') {
        if (responseData.error && typeof responseData.error === 'object') {
          errorMessage = responseData.error.message || errorMessage;
          errorCode = responseData.error.code || errorCode;
        } else if (responseData.message) {
          errorMessage = responseData.message;
        }
      }

      // If token expired or invalid (401), purge stale auth token and redirect to login
      if (response.status === 401) {
        setStoredAuthToken(null);
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem(AUTH_TOKEN_KEY);
            const userRaw = localStorage.getItem(USER_STORAGE_KEY);
            if (userRaw) {
              const u = JSON.parse(userRaw);
              delete u.token;
              delete u.accessToken;
              localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(u));
            }
          } catch {
            // Ignore storage cleanup issues
          }

          // Broadcast 401 event for active React contexts
          window.dispatchEvent(
            new CustomEvent('hader:unauthorized', {
              detail: { status: 401, message: errorMessage }
            })
          );

          // Clean redirect to login if outside auth view
          if (window.location.pathname !== '/auth' && !window.location.pathname.startsWith('/auth')) {
            window.location.href = '/auth';
          }
        }
      }

      throw new ApiError(errorMessage, response.status, errorCode, responseData);
    }

    return responseData;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof ApiError) {
      throw err;
    }

    if (err.name === 'AbortError') {
      throw new ApiError('انتهت مهلة الاتصال بالخادم (Request Timeout)', 408, 'TIMEOUT');
    }

    // Network disconnection or CORS failure
    throw new ApiError(
      err.message || 'تعذر الاتصال بالخادم السحابي، يُرجى التأكد من اتصال الإنترنت',
      0,
      'NETWORK_ERROR',
      err
    );
  }
}

// Convenient HTTP methods
export const apiClient = {
  get: (endpoint, options = {}) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'POST', body }),
  put: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'PUT', body }),
  patch: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'PATCH', body }),
  delete: (endpoint, options = {}) => request(endpoint, { ...options, method: 'DELETE' }),

  /**
   * Diagnostic health check targeting the Fly.io root engine
   */
  async healthCheck() {
    try {
      const result = await request('/health', { timeoutMs: 8000 });
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // Token management helpers
  getStoredAuthToken,
  setStoredAuthToken
};

export default apiClient;
