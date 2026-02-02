import * as React from 'react';
import type { Metadata } from 'next';
import ThemeRegistry from '@/components/ThemeRegistry/ThemeRegistry';
import AppLayout from '@/components/layout/AppLayout';
import { UserProvider } from '@/context/UserContext';
import GoogleAnalytics from '@/components/common/GoogleAnalytics';

export const metadata: Metadata = {
  title: 'Fantasy Football Analytics',
  description: 'Advanced fantasy football tools and rankings',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <GoogleAnalytics GA_MEASUREMENT_ID="G-KC140X1TPV" />
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
