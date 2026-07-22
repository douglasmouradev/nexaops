import { create } from 'zustand';
import type { AuthUser } from '@nexaops/shared';
import { api } from '@/lib/api';

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  register: (data: { email: string; password: string; name: string; organizationName: string }) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: !!api.getAccessToken(),
  isLoading: true,

  login: async (email, password, totpCode) => {
    const res = await api.post<{ success: boolean; data: { user: AuthUser; tokens: { accessToken: string; refreshToken: string } } }>(
      '/api/auth/login',
      { email, password, totpCode }
    );
    api.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);
    set({ user: res.data.user, isAuthenticated: true });
  },

  register: async (data) => {
    const res = await api.post<{ success: boolean; data: { user: AuthUser; tokens: { accessToken: string; refreshToken: string } } }>(
      '/api/auth/register',
      data
    );
    api.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);
    set({ user: res.data.user, isAuthenticated: true });
  },

  logout: () => {
    api.clearTokens();
    set({ user: null, isAuthenticated: false });
  },

  loadUser: async () => {
    if (!api.getAccessToken()) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }
    try {
      const res = await api.get<{ success: boolean; data: AuthUser }>('/api/auth/me');
      set({ user: res.data, isAuthenticated: true, isLoading: false });
    } catch {
      api.clearTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));

interface ThemeState {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    set({ theme: next });
  },
}));

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: false,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
}));

interface DeviceSelectionState {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

export const useDeviceSelection = create<DeviceSelectionState>((set, get) => ({
  selectedIds: new Set(),
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
  selectAll: (ids) => set({ selectedIds: new Set(ids) }),
  clear: () => set({ selectedIds: new Set() }),
  isSelected: (id) => get().selectedIds.has(id),
}));
