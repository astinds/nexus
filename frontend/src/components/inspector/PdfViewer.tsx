'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { clampPage, parsePageInput, progressPercent } from '@/lib/reader';

/**
 * Mobile-first PDF canvas viewer.
 *
 * Design constraints that shaped this:
 *   * Readable on a 390px phone: a fit-width page is tiny, so zoom is explicit
 *     (`-` / `Fit` / `+`) instead of a pinch-only gesture, and panning pans the
 *     wrapped element rather than re-rendering the canvas.
 *   * Cheap on a 512 MB backend-adjacent device budget: exactly one page bitmap
 *     is mounted. `prefetch` warms ±1 page objects (not canvases), which is what
 *     removes the stall when turning a page without holding three RGBA buffers.
 *   * Navigation must never require 100 taps: a scrubber plus a tappable
 *     `14 / 278` badge that accepts a typed page number.
 *   * Night reading: white paper at 2am is hostile, so an invert filter is one
 *     tap and is remembered for the session.
 *
 * `pdfjs-dist` is imported dynamically so it never enters the server bundle.
 */

interface Props {
  itemId: string;
  /** 1-based page to open (matches segment_index for PDFs). */
  initialPage?: number;
  onPageChange?: (page: number) => void;
  /** Hide the built-in download link when it lives in the Manage sheet. */
  showDownload?: boolean;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;

export default function PdfViewer({
  itemId,
  initialPage = 1,
  onPageChange,
  showDownload = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(Math.max(1, initialPage));
  const [width, setWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [night, setNight] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');

  const goTo = useCallback(
    (next: number) => {
      setPage((previous) => {
        const clamped = clampPage(next, numPages || 1);
        if (clamped !== previous) onPageChange?.(clamped);
        return clamped;
      });
    },
    [numPages, onPageChange],
  );

  // Load the document once per item.
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
        setPage((previous) => clampPage(previous, doc.numPages));
        setError('');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not open this PDF.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      void docRef.current?.destroy();
      docRef.current = null;
      // Release the backing bitmap now: on Android Chrome a 2x-DPR page holds
      // tens of MB, and the canvas outlives the react node briefly after a swap.
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
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

  // Warm the adjacent page *objects* only. No canvas, no second bitmap.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    for (const neighbour of [page - 1, page + 1]) {
      if (neighbour >= 1 && neighbour <= doc.numPages) {
        void doc.getPage(neighbour).catch(() => undefined);
      }
    }
  }, [page, numPages]);

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
        const fit = width / base.width;
        const viewport = current.getViewport({ scale: fit * zoom });
        const context = canvas.getContext('2d');
        if (!context) return;

        // Cap the device pixel ratio: full DPR on a phone at fit-width is wasted RAM.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.style.filter = night ? 'invert(0.9) hue-rotate(180deg)' : '';

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
  }, [page, width, numPages, zoom, night]);

  // Swipe horizontally to turn pages, but only at fit width: once zoomed in,
  // a horizontal drag belongs to panning.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    const point = event.touches[0];
    touch.current = { x: point.clientX, y: point.clientY };
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || zoom > 1) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goTo(dx < 0 ? page + 1 : page - 1);
  };

  if (error) {
    return (
      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p className="opacity-80">{error}</p>
        <a
          href={`/api/v1/items/${itemId}/download`}
          target="_blank"
          rel="noreferrer"
          className="inline-block underline underline-offset-2 opacity-80"
        >
          Open the original file
        </a>
      </div>
    );
  }

  const submitJump = () => {
    const target = parsePageInput(jumpValue);
    if (target !== null) goTo(target);
    setJumpOpen(false);
    setJumpValue('');
  };

  return (
    <div className="space-y-2">
      {/* toolbar: navigation, zoom, night, download */}
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <button
          type="button"
          onClick={() => goTo(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="rounded-md border border-[var(--border)] px-2 py-1 disabled:opacity-40"
        >
          ‹
        </button>

        {jumpOpen ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={jumpValue}
              onChange={(event) => setJumpValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitJump();
                if (event.key === 'Escape') setJumpOpen(false);
              }}
              inputMode="numeric"
              aria-label="Jump to page"
              className="w-14 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-center tabular-nums"
            />
            <button type="button" onClick={submitJump} className="rounded-md bg-[var(--accent)] px-2 py-1 text-black">
              Go
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setJumpOpen(true)}
            className="rounded-md border border-[var(--border)] px-2 py-1 tabular-nums"
            aria-label="Jump to a page number"
          >
            {page} / {numPages || '…'}
          </button>
        )}

        <button
          type="button"
          onClick={() => goTo(page + 1)}
          disabled={!numPages || page >= numPages}
          aria-label="Next page"
          className="rounded-md border border-[var(--border)] px-2 py-1 disabled:opacity-40"
        >
          ›
        </button>

        <span className="mx-1 h-4 w-px bg-[var(--border)]" />

        <button
          type="button"
          onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - ZOOM_STEP))}
          aria-label="Zoom out"
          className="rounded-md border border-[var(--border)] px-2 py-1"
        >
          −
        </button>
        <button type="button" onClick={() => setZoom(1)} className="rounded-md border border-[var(--border)] px-2 py-1">
          Fit
        </button>
        <button
          type="button"
          onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + ZOOM_STEP))}
          aria-label="Zoom in"
          className="rounded-md border border-[var(--border)] px-2 py-1"
        >
          +
        </button>

        <button
          type="button"
          onClick={() => setNight((value) => !value)}
          aria-pressed={night}
          aria-label="Night mode"
          className={`rounded-md border px-2 py-1 ${night ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)]'}`}
        >
          ☾
        </button>

        <span className="flex-1" />
        {showDownload ? (
          <a
            href={`/api/v1/items/${itemId}/download`}
            target="_blank"
            rel="noreferrer"
            className="opacity-60 hover:opacity-100"
          >
            Original
          </a>
        ) : null}
      </div>

      {/* scrubber */}
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={1}
          max={numPages || 1}
          value={page}
          onChange={(event) => goTo(Number(event.target.value))}
          aria-label="Page scrubber"
          className="h-1 flex-1 accent-[var(--accent)]"
        />
        <span className="w-9 shrink-0 text-right text-[10px] tabular-nums opacity-50">
          {progressPercent(page, numPages)}%
        </span>
      </div>

      <div
        ref={wrapRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={`overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 ${
          zoom > 1 ? 'max-h-[70vh]' : ''
        }`}
      >
        {loading ? <p className="py-16 text-center text-xs opacity-50">Loading PDF…</p> : null}
        <canvas ref={canvasRef} className="mx-auto block touch-pan-x" />
      </div>
    </div>
  );
}
