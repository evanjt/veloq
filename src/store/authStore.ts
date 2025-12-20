import { create } from 'zustand';
import type { Athlete } from '@/types';

interface AuthState {
  athlete: Athlete | null;
  isAuthenticated: boolean;
  setAthlete: (athlete: Athlete) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  athlete: null,
  isAuthenticated: false,
  setAthlete: (athlete) => set({ athlete, isAuthenticated: true }),
  clearAuth: () => set({ athlete: null, isAuthenticated: false }),
}));
