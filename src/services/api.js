/**
 * Hader-V2 HTTP API Export & Compatibility Layer
 * Re-exports apiClient, constants, and utilities from apiClient.js
 */

export {
  apiClient,
  API_BASE_URL,
  API_V1_URL,
  AUTH_TOKEN_KEY,
  USER_STORAGE_KEY,
  ApiError,
  getStoredAuthToken,
  setStoredAuthToken
} from './apiClient.js';

export { default } from './apiClient.js';

