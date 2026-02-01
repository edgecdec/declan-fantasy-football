import * as React from 'react';
import type { Metadata } from 'next';
import ThemeRegistry from '@/components/ThemeRegistry/ThemeRegistry';
import AppLayout from '@/components/layout/AppLayout';

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
        <ThemeRegistry>
          <AppLayout>
            {children}
          </AppLayout>
        </ThemeRegistry>
      </body>
    </html>
  );
}
