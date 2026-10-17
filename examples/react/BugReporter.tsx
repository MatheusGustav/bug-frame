// React (and Preact/Next client components): mount once near the root. The widget lives in its own Shadow DOM, so React never renders it.
import { useEffect } from 'react';
import { init, type InitOptions } from 'bugframe';

export function BugReporter(props: InitOptions) {
  useEffect(() => {
    const bugframe = init(props);
    return () => bugframe.destroy(); // strict mode / hot reload safe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// App.tsx
// Render this component only for a signed-in user with reporting permission:
//   {auth.user?.canReportBugs && <BugReporter key={auth.user.id} endpoint="/api/bugframe"
//                metadata={() => ({ appVersion: __APP_VERSION__ })} />}
// The server's authorize hook must independently verify that permission on every request.
// Same-origin session cookies are sent by fetch automatically. Then open the app with ?bugs=1.
