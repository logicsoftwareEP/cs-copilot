import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '../types';
import { getMe } from '../services/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: 'unauthorized' | 'forbidden' | null;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, error: null });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });

  useEffect(() => {
    (async () => {
      let email = '';

      // Local dev bypass
      if (import.meta.env.VITE_SKIP_AUTH) {
        email = import.meta.env.VITE_USER_EMAIL ?? 'dev@localhost';
      } else {
        // Check SWA authentication
        try {
          const res = await fetch('/.auth/me');
          const data = await res.json();
          if (!data.clientPrincipal) {
            window.location.href = '/.auth/login/aad';
            return;
          }
          email = data.clientPrincipal.userDetails ?? '';
        } catch {
          window.location.href = '/.auth/login/aad';
          return;
        }
      }

      // Check app-level authorization
      try {
        const user = await getMe();
        setState({ user, loading: false, error: null });
      } catch (err: any) {
        if (err.message?.includes('auth:401')) {
          setState({ user: null, loading: false, error: 'unauthorized' });
        } else if (err.message?.includes('auth:403')) {
          setState({ user: null, loading: false, error: 'forbidden' });
        } else {
          setState({ user: null, loading: false, error: 'unauthorized' });
        }
      }
    })();
  }, []);

  if (state.loading) {
    return (
      <div className="min-h-screen bg-obs-void flex items-center justify-center">
        <p className="text-obs-dim text-lg">Loading...</p>
      </div>
    );
  }

  if (state.error === 'forbidden') {
    return (
      <div className="min-h-screen bg-obs-void flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-obs-bright mb-2">Access Denied</h1>
          <p className="text-obs-dim">Your account is not registered. Contact your admin.</p>
          <a href="/.auth/logout" className="text-obs-accent hover:text-obs-glow mt-4 inline-block">Sign out</a>
        </div>
      </div>
    );
  }

  if (!state.user) {
    return (
      <div className="min-h-screen bg-obs-void flex items-center justify-center">
        <p className="text-obs-dim text-lg">Redirecting to login...</p>
      </div>
    );
  }

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
