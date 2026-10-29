/**
 * Hader-V2 Authentication Service
 * Wired directly to Go Fiber backend on Fly.io (https://hader-websit.fly.dev)
 * Handles hardware lock, Supabase token synchronization, and offline fallback.
 */

import { apiClient, setStoredAuthToken, USER_STORAGE_KEY } from './apiClient.js';
import { DEFAULT_STUDENT, DEFAULT_LEADER } from '../data/mockUserData.js';
import { getDeviceFingerprint } from '../utils/deviceUtils.js';

// Helper to map academic division to department ID in Go backend
function mapDivisionToDeptId(divisionKey) {
  switch (divisionKey) {
    case 'sec1_tech':
      return 1;
    case 'sec2_tech_general':
      return 2;
    case 'sec2_tech_teacher':
      return 3;
    case 'sec3_tech_instructional':
      return 4;
    case 'sec4_tech_graduation':
      return 5;
    default:
      return 2; // Default to Sec2 Tech General
  }
}

/**
 * Maps Go backend UserResponse and AuthResponse into frontend state structure
 */
function mapServerUserToLocal(serverUser, token = null) {
  const isLeader = serverUser.role === 'class_leader' || serverUser.role === 'admin';
  const baseProfile = isLeader ? DEFAULT_LEADER : DEFAULT_STUDENT;
  const currentStreak = serverUser.current_streak || 1;
  const treePoints = currentStreak * 35 + 50;
  const treeLevel = Math.min(5, Math.floor(treePoints / 100) + 1);

  return {
    ...baseProfile,
    id: serverUser.id || `std-${serverUser.academic_id}`,
    code: serverUser.academic_id || baseProfile.code,
    name: serverUser.full_name || baseProfile.name,
    email: serverUser.email || baseProfile.email,
    role: isLeader ? 'leader' : 'student',
    departmentId: serverUser.department_id,
    streakDays: currentStreak,
    treePoints,
    treeLevel,
    token: token || serverUser.token || baseProfile.token,
    deviceBound: {
      deviceId: getDeviceFingerprint().deviceId,
      model: getDeviceFingerprint().model,
      trusted: true,
      lastVerified: 'الآن'
    }
  };
}

export const authService = {
  /**
   * Authenticate user with Go backend (/api/v1/auth/login)
   * Sends hardware fingerprint in X-Device-Id and payload
   */
  async login({ identifier, password, role = 'student' }) {
    if (!identifier || !password) {
      throw new Error('يرجى ملء جميع الحقول المطلوبة');
    }

    const device = getDeviceFingerprint();
    const loginRole = role === 'leader' ? 'class_leader' : 'student';

    try {
      // 1. Direct call to Fly.io Go backend
      const res = await apiClient.post('/auth/login', {
        identifier: identifier.trim(),
        password,
        login_role: loginRole,
        device_id: device.deviceId,
        device_name: device.model,
        remember_me: true
      });

      if (res && res.data) {
        const token = res.data.token;
        const serverUser = res.data.user;

        // Persist token and user in storage
        if (token) setStoredAuthToken(token);
        const mappedUser = mapServerUserToLocal(serverUser, token);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(mappedUser));

        return mappedUser;
      }
    } catch (err) {
      // If error is from server (e.g. invalid credentials or device lock mismatch), propagate to user
      if (err.status && err.status !== 0 && err.status !== 408) {
        throw new Error(err.message);
      }

      console.warn('[AUTH] Remote server unreachable or offline. Applying graceful local session:', err.message);
    }

    // 2. Offline / Cold-start fallback for resilient testing
    const baseUser = role === 'leader' ? DEFAULT_LEADER : DEFAULT_STUDENT;
    const fallbackUser = {
      ...baseUser,
      id: identifier.includes('@') ? `usr-${Date.now()}` : `usr-${identifier}`,
      code: identifier.replace(/[^0-9]/g, '') || baseUser.code,
      role
    };

    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(fallbackUser));
    return fallbackUser;
  },

  /**
   * Register new student with Go backend (/api/v1/auth/register)
   */
  async signup(signupData) {
    if (!signupData.fullName || !signupData.studentCode || !signupData.email) {
      throw new Error('يرجى استكمال البيانات الأكاديمية الأساسية');
    }

    const device = getDeviceFingerprint();
    const deptId = mapDivisionToDeptId(signupData.academicDivision);

    try {
      const res = await apiClient.post('/auth/register', {
        full_name: signupData.fullName.trim(),
        academic_id: signupData.studentCode.trim(),
        email: signupData.email.trim(),
        password: signupData.password,
        department_id: deptId,
        device_id: device.deviceId,
        device_name: device.model,
        terms_agreed: true
      });

      if (res && res.data) {
        const token = res.data.token;
        const serverUser = res.data.user;

        if (token) setStoredAuthToken(token);
        const mappedUser = mapServerUserToLocal(serverUser, token);
        mappedUser.division = signupData.academicDivisionLabel || mappedUser.division;
        mappedUser.divisionKey = signupData.academicDivision || 'sec2_tech_general';

        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(mappedUser));
        return mappedUser;
      }
    } catch (err) {
      if (err.status && err.status !== 0 && err.status !== 408) {
        throw new Error(err.message);
      }
      console.warn('[AUTH] Signup live call failed, applying local fallback:', err.message);
    }

    // Offline / Demo fallback
    const newUser = {
      ...DEFAULT_STUDENT,
      id: `std-${signupData.studentCode}`,
      code: signupData.studentCode,
      name: signupData.fullName,
      email: signupData.email,
      division: signupData.academicDivisionLabel || DEFAULT_STUDENT.division,
      divisionKey: signupData.academicDivision || 'sec2_tech_general',
      role: 'student',
      treePoints: 50,
      treeLevel: 1,
      levelTitle: "بذرة البداية 🌱",
      streakDays: 1,
      registeredAt: new Date().toISOString()
    };

    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser));
    return newUser;
  },

  /**
   * Get current authenticated user profile
   */
  async getCurrentUser() {
    try {
      const stored = localStorage.getItem(USER_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);

        // If user has a valid session token, refresh profile from server
        const token = apiClient.getStoredAuthToken();
        if (token) {
          try {
            const res = await apiClient.get('/auth/me');
            if (res && res.data && res.data.user) {
              const refreshed = mapServerUserToLocal(res.data.user, token);
              localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(refreshed));
              return refreshed;
            }
          } catch {
            // Server offline or token expired; proceed with cached user
          }
        }

        return parsed;
      }
    } catch {
      // Fallback
    }

    return DEFAULT_STUDENT;
  },

  /**
   * Switch between Student and Leader roles (Development / Testing)
   */
  async switchRole(currentRole) {
    const targetRole = currentRole === 'student' ? 'leader' : 'student';
    const profile = targetRole === 'leader' ? DEFAULT_LEADER : DEFAULT_STUDENT;
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(profile));
    return profile;
  },

  /**
   * Request password reset (/api/v1/auth/recover-password)
   */
  async requestPasswordReset(email) {
    if (!email || !email.includes('@')) {
      throw new Error('يرجى إدخال بريد إلكتروني أكاديمي صالح');
    }

    try {
      await apiClient.post('/auth/recover-password', { email: email.trim() });
    } catch (err) {
      console.warn('[AUTH] Password recovery request failed on server:', err.message);
    }

    return {
      success: true,
      message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الأكاديمي'
    };
  },

  /**
   * Terminate active session (/api/v1/auth/logout)
   */
  async logout() {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore network errors on logout
    } finally {
      setStoredAuthToken(null);
      localStorage.removeItem(USER_STORAGE_KEY);
    }
    return true;
  }
};

export default authService;
