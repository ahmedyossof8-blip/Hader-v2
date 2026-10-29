import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';
import { DEFAULT_STUDENT } from '../data/mockUserData';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(DEFAULT_STUDENT);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState(null);

  // Initialize from storage or default
  useEffect(() => {
    let mounted = true;
    authService.getCurrentUser().then((userData) => {
      if (mounted && userData) {
        setUser(userData);
      }
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const triggerToast = useCallback((msg, type = 'info') => {
    setToastMessage({ msg, type, id: Date.now() });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  }, []);

  // Listen for 401 unauthorized purge events from apiClient
  useEffect(() => {
    const handleUnauthorized = (e) => {
      setUser(DEFAULT_STUDENT);
      const msg = e?.detail?.message || 'انتهت صلاحية الجلسة الأكاديمية، يُرجى تسجيل الدخول مجدداً';
      triggerToast(msg, 'error');
    };

    window.addEventListener('hader:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('hader:unauthorized', handleUnauthorized);
    };
  }, [triggerToast]);

  const login = async ({ identifier, password, role }) => {
    try {
      const loggedIn = await authService.login({ identifier, password, role });
      setUser(loggedIn);
      triggerToast(
        loggedIn.role === 'leader'
          ? 'تم تسجيل الدخول بصلاحيات ممثل الدفعة 🛡️'
          : 'أهلاً بك مجدداً في منصة حاضر 🎓',
        'success'
      );
      return loggedIn;
    } catch (err) {
      triggerToast(err.message, 'error');
      throw err;
    }
  };

  const signup = async (signupData) => {
    try {
      const newUser = await authService.signup(signupData);
      setUser(newUser);
      triggerToast('تم تسجيل حسابك الأكاديمي بنجاح وتوليد بطاقتك الرقمية ✨', 'success');
      return newUser;
    } catch (err) {
      triggerToast(err.message, 'error');
      throw err;
    }
  };

  const toggleRole = async () => {
    try {
      const switched = await authService.switchRole(user.role);
      setUser(switched);
      triggerToast(
        switched.role === 'leader'
          ? 'تم التحويل إلى وضع ممثل الدفعة (Leader Mode) 🛡️'
          : 'تم التحويل إلى وضع الطالب (Student Mode) 🎓',
        'info'
      );
      return switched;
    } catch (err) {
      triggerToast('تعذر تبديل الصلاحية', 'error');
    }
  };

  const logout = async () => {
    await authService.logout();
    setUser(DEFAULT_STUDENT);
    triggerToast('تم تسجيل الخروج بنجاح');
  };

  const isLeader = user?.role === 'leader';

  const value = {
    user,
    role: user?.role || 'student',
    isLeader,
    loading,
    toastMessage,
    triggerToast,
    login,
    signup,
    toggleRole,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
