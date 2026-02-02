import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'League History | FF Analytics',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
