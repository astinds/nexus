'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * Mobile-safe PDF canvas viewer.
 *
 * `pdfjs-dist` is imported dynamically inside an effect so the module (and its
 * browser-only globals) never reaches the server bundle — `next build` stays
 * happy on Vercel. The worker is served from /public, not a CDN, so the viewer
 * works offline and behind the same origin.
 */

interface Props {
  itemId: string;
  /** 1-based page to open (matches segment_index for PDFs). */
  initialPage?: number;
  onPageChange?: (page: number) => void;
}

export default function PdfViewer({ itemId, initialPage = 1, onPageChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(Math.max(1, initialPage));
  const [width, setWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Load the document once.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const res = await fetch(`/api/v1/items/${itemId}/download`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`Could not load the file (${res.status}).`);
        const data = new Uint8Array(await res.arrayBuffer());

        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        setPage((current) => Math.min(Math.max(1, current), doc.numPages));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not render this PDF.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [itemId]);

  // Fit-to-width: track the container, not the viewport, so the sidebar counts.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.max(0, Math.floor(next)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Render the current page.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || width === 0) return;

    let cancelled = false;
    let task: { cancel: () => void } | null = null;

    (async () => {
      try {
        const current = await doc.getPage(page);
        if (cancelled) return;

        const base = current.getViewport({ scale: 1 });
        const scale = width / base.width;
        const viewport = current.getViewport({ scale });
        const context = canvas.getContext('2d');
        if (!context) return;

        // Cap the device pixel ratio: full DPR on a phone at fit-width is wasted RAM.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const render = current.render({
          canvasContext: context,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        });
        task = render;
        await render.promise;
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (!cancelled && name !== 'RenderingCancelledException') {
          setError('This page could not be rendered.');
        }
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [page, width, numPages]);

  const goTo = (next: number) => {
    const clamped = Math.min(Math.max(1, next), numPages || 1);
    setPage(clamped);
    onPageChange?.(clamped);
  };

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p>{error}</p>
        <a
          href={`/api/v1/items/${itemId}/download`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block underline underline-offset-2 opacity-80"
        >
          Open the original file
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page <= 1}
            className="rounded-md border border-[var(--border)] px-2 py-1 disabled:opacity-40"
          >
            ‹
          </button>
          <span className="tabular-nums opacity-60">
            {page} / {numPages || '…'}
          </span>
          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={!numPages || page >= numPages}
            className="rounded-md border border-[var(--border)] px-2 py-1 disabled:opacity-40"
          >
            ›
          </button>
        </div>
        <a
          href={`/api/v1/items/${itemId}/download`}
          target="_blank"
          rel="noreferrer"
          className="opacity-60 hover:opacity-100"
        >
          Open / download
        </a>
      </div>

      <div
        ref={wrapRef}
        className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1"
      >
        {loading ? <p className="py-16 text-center text-xs opacity-50">Loading PDF…</p> : null}
        <canvas ref={canvasRef} className="mx-auto block max-w-full" />
      </div>
    </div>
  );
}
