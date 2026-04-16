import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Manager Skill Hub | FF Analytics',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
