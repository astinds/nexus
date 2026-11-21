'use client';

import Shell from '@/components/Shell';
import OmniCaptureModal from '@/components/OmniCaptureModal';

export default function CapturePage() {
  return (
    <Shell>
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Omni-Capture</h1>
        <p className="text-sm opacity-70">Capture anything: files, URLs, pasted text, or fresh Markdown notes.</p>
        <OmniCaptureModal onClose={() => {}} />
      </div>
    </Shell>
  );
}
