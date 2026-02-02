import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Player Database | FF Analytics',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
