'use client';

import * as React from 'react';
import { sendGAEvent } from '@next/third-parties/google';
import { SleeperUser, SleeperService } from '@/services/sleeper/sleeperService';
import { safeLocalSet } from '@/services/common/cacheService';

interface UserContextType {
  user: SleeperUser | null;
  loading: boolean;
  setUser: (user: SleeperUser | null) => void;
  fetchUser: (username: string) => Promise<void>;
  logout: () => void;
}

const UserContext = React.createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = React.useState<SleeperUser | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Load from local storage on mount
  React.useEffect(() => {
    const saved = localStorage.getItem('sleeper_active_user');
    if (saved) {
      try {
        setUserState(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved user', e);
      }
    }
  }, []);

  const setUser = (newUser: SleeperUser | null) => {
    setUserState(newUser);
    if (newUser) {
      safeLocalSet('sleeper_active_user', JSON.stringify(newUser));
      // Also save to history
      const history = JSON.parse(localStorage.getItem('sleeper_usernames') || '[]');
      if (!history.includes(newUser.username)) {
        safeLocalSet('sleeper_usernames', JSON.stringify([newUser.username, ...history].slice(0, 5)));
      }
      
      // Track in GA
      sendGAEvent('event', 'login', { method: 'Sleeper', username: newUser.username });
    } else {
      localStorage.removeItem('sleeper_active_user');
    }
  };

  const fetchUser = async (username: string) => {
    setLoading(true);
    try {
      const data = await SleeperService.getUser(username);
      if (data) {
        setUser(data);
      } else {
        throw new Error('User not found');
      }
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => setUser(null);

  return (
    <UserContext.Provider value={{ user, loading, setUser, fetchUser, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = React.useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
