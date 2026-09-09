import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'The Zone | Declanalytics',
  description:
    'Live NFL play-by-play, scored in every one of your leagues at once — what each play was '
    + 'worth to your lineup and to the lineup you are playing against.',
};

export default function ZoneLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
