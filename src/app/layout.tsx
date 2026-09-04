import * as React from 'react';
import type { Metadata } from 'next';
import { GoogleAnalytics } from '@next/third-parties/google';
import ThemeRegistry from '@/components/ThemeRegistry/ThemeRegistry';
import AppLayout from '@/components/layout/AppLayout';
import { UserProvider } from '@/context/UserContext';
import { CustomRankingsProvider } from '@/context/CustomRankingsContext';
import { BettingAuthProvider } from '@/context/BettingAuthContext';

const FOOTBALL_FAVICON = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏈</text></svg>';

export const metadata: Metadata = {
  title: 'Declanalytics',
  description: 'Advanced fantasy football analytics, tools, and rankings for every manager.',
  icons: { icon: FOOTBALL_FAVICON },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning={true}>
        <GoogleAnalytics gaId="G-KC140X1TPV" />
        <ThemeRegistry>
          <UserProvider>
            <CustomRankingsProvider>
              {/* Wraps AppLayout because the nav needs to know whether a betting
                  session exists to decide whether to show Declan Dollars. */}
              <BettingAuthProvider>
                <AppLayout>
                  {children}
                </AppLayout>
              </BettingAuthProvider>
            </CustomRankingsProvider>
          </UserProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
}
