import type { Metadata } from 'next';
import { BettingAuthProvider } from '@/context/BettingAuthContext';

export const metadata: Metadata = { title: 'Declan Dollars | FF Analytics' };

/**
 * The betting session provider is scoped to this route subtree rather than the
 * root layout — no other page needs it, and keeping it here means the rest of
 * the app never fetches the session.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <BettingAuthProvider>{children}</BettingAuthProvider>;
}
