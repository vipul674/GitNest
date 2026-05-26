import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { loginUser, registerUser, getMe } from '../api/authApi';

const extractUserData = (responseData) => {
  const payload = responseData?.data ?? responseData;

  if (!payload) {
    return null;
  }

  const { _id, username, email, token } = payload;
  return { _id, username, email, token };
};

const extractErrorMessage = (error) => {
  if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors.map((err) => err.message).join(', ');
  }
  return error?.message || 'An error occurred';
};

const getFriendlyAuthError = (error, fallbackMessage) => {
  const message = extractErrorMessage(error);

  if (message && message !== 'An error occurred') {
    return message;
  }

  return fallbackMessage;
};

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      loading: false,
      error: null,

      login: async (email, password) => {
        set({ loading: true, error: null });
        try {
          const res = await loginUser({ email, password });
          const user = extractUserData(res);
          set({
            user,
            token: user?.token ?? null,
            isAuthenticated: true,
            loading: false,
          });
        } catch (error) {
          set({
            error: getFriendlyAuthError(error, 'Login failed'),
            loading: false,
          });
          throw error;
        }
      },

      register: async (userData) => {
        set({ loading: true, error: null });
        try {
          const res = await registerUser(userData);
          const user = extractUserData(res);
          set({
            user,
            token: user?.token ?? null,
            isAuthenticated: true,
            loading: false,
          });
        } catch (error) {
          set({
            error: getFriendlyAuthError(error, 'Registration failed'),
            loading: false,
          });
          throw error;
        }
      },

      logout: () => {
        set({ user: null, token: null, isAuthenticated: false, error: null });
      },
      clearError: () => {
        set({ error: null });
      },
      checkAuth: async () => {
        set({ loading: true, error: null });
        try {
          const res = await getMe();
          set({
            user: extractUserData(res),
            isAuthenticated: true,
            loading: false,
          });
        } catch {
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            loading: false,
          });
        }
      },
    }),
    {
      name: 'auth-storage', // local storage key
    }
  )
);
