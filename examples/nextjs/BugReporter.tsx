'use client';
// app/BugReporter.tsx - render <BugReporter /> once in app/layout.tsx
import { useEffect } from 'react';
import { init } from 'bugframe';

export default function BugReporter() {
  useEffect(() => {
    const bug = init({ endpoint: '/api/bugframe', token: process.env.NEXT_PUBLIC_BUGFRAME_TOKEN, metadata: () => ({ route: location.pathname, build: process.env.NEXT_PUBLIC_BUILD_ID }) });
    return () => bug.destroy();
  }, []);
  return null;
}
