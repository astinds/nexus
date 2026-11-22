'use client';

/**
 * Client-side providers shared by every route: theme tokens, the cold-start
 * banner and the passcode gate. Kept out of layout.tsx so the layout itself can
 * stay a server component (needed for `metadata` and PWA manifest wiring).
 */

import PasscodeGate from '@/components/PasscodeGate';
import WakeBanner from '@/components/WakeBanner';
import { ThemeProvider } from '@/lib/useTheme';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <WakeBanner />
      <PasscodeGate>{children}</PasscodeGate>
    </ThemeProvider>
  );
}
