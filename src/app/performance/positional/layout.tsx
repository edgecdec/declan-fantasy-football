import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Positional Benchmarks | FF Analytics',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
