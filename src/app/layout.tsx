import * as React from 'react';
import type { Metadata } from 'next';
import { GoogleAnalytics } from '@next/third-parties/google';
import ThemeRegistry from '@/components/ThemeRegistry/ThemeRegistry';
import AppLayout from '@/components/layout/AppLayout';
import { UserProvider } from '@/context/UserContext';

export const metadata: Metadata = {
  title: 'Declanalytics',
  description: 'Advanced fantasy football analytics, tools, and rankings for every manager.',
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
            <AppLayout>
              {children}
            </AppLayout>
          </UserProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
}
