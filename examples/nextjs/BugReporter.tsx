'use client';
// Render <BugReporter key={session.user.id} /> only inside the approved-user portion of your authenticated layout.
// The API authorize hook remains the enforcement point even if someone mounts this themselves.
import { useEffect } from 'react';
import { init } from 'bugframe';

export default function BugReporter() {
  useEffect(() => {
    const bug = init({ endpoint: '/api/bugframe', metadata: () => ({ route: location.pathname, build: process.env.NEXT_PUBLIC_BUILD_ID }) });
    return () => bug.destroy();
  }, []);
  return null;
}
