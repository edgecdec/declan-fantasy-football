import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Portfolio Tracker | FF Analytics',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
