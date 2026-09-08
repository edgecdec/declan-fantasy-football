import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'This Week | Declanalytics',
  description:
    'Every matchup you have going this week across all your leagues, with live win '
    + 'probabilities and a netted rooting interest for every player still to play.',
};

export default function WeekLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
