import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Declan Dollars | FF Analytics' };

/**
 * Metadata only. BettingAuthProvider lives in the root layout because the nav
 * needs the session too — nesting a second provider here would give this subtree
 * its own copy of the state and they would drift.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
