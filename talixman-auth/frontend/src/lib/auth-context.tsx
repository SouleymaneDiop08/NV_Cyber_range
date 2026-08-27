import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import axios from 'axios';
import { createContext, useContext, type ReactNode } from 'react';
import { logout as apiLogout, me, type SessionUser } from './api';

interface AuthContextValue {
  user: SessionUser | null | undefined;
  isLoading: boolean;
  refetch: UseQueryResult['refetch'];
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return await me();
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          return null;
        }
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  async function logout() {
    await apiLogout();
    queryClient.setQueryData(['auth', 'me'], null);
  }

  return (
    <AuthContext.Provider
      value={{ user: query.data, isLoading: query.isLoading, refetch: query.refetch, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé sous <AuthProvider>.');
  return ctx;
}
