import { useAuthStore } from '@/stores';

/** ADMIN e TECHNICIAN podem escrever; READ_ONLY só leitura */
export function useCanWrite(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  return role === 'ADMIN' || role === 'TECHNICIAN';
}

export function useIsAdmin(): boolean {
  return useAuthStore((s) => s.user?.role) === 'ADMIN';
}
