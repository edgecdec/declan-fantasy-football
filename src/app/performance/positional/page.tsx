'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PositionalBenchmarksRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/skill?tab=efficiency');
  }, [router]);
  return null;
}
