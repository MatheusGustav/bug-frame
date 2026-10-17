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
//   <BugReporter endpoint="/api/bugframe" token={import.meta.env.VITE_BUGFRAME_TOKEN}
//                metadata={() => ({ appVersion: __APP_VERSION__, userId: auth.user?.id })} />
// Then open the app once with ?bugs=1.
