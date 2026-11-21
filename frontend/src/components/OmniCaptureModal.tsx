'use client';

import { useCallback, useEffect, useState } from 'react';
import { ingestText, ingestUrl, getIngestFormats } from '@/lib/api';
import { IngestTextRequest } from '@/lib/types';

interface OmniCaptureModalProps {
  onClose: () => void;
}

type Tab = 'file' | 'url' | 'note';

export default function OmniCaptureModal({ onClose }: OmniCaptureModalProps) {
  const [tab, setTab] = useState<Tab>('note');
  const [formats, setFormats] = useState<string[]>([]);
  const [loadingFormats, setLoadingFormats] = useState(true);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'file', label: 'Upload File' },
    { id: 'url', label: 'Clip URL' },
    { id: 'note', label: 'New Markdown' },
  ];

  useEffect(() => {
    void (async () => {
      try {
        const formatsResp = await getIngestFormats();
        setFormats(formatsResp.formats.map((f) => f.toLowerCase()));
      } catch {
        // keep empty
      } finally {
        setLoadingFormats(false);
      }
    })();
  }, []);

  const close = useCallback(() => {
    setResult(null);
    onClose();
  }, [onClose]);

  // --- Upload File tab ---
  const [file, setFile] = useState<File | null>(null);
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setResult({ ok: false, msg: 'File exceeds 25 MB limit.' });
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase();
    const fmt = ext && formats.includes(ext) ? (ext as any) : 'markdown';
    const body = new FormData();
    body.append('file', file);
    body.append('source_format', String(fmt));
    try {
      const res = await fetch('/api/v1/ingest', {
        method: 'POST',
        body,
        credentials: 'include',
      });
      if (!res.ok) {
        setResult({ ok: false, msg: `Upload failed (${res.status})` });
        return;
      }
      setResult({ ok: true, msg: 'File uploaded successfully.' });
      setFile(null);
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Upload failed.' });
    }
  };

  // --- Clip URL tab ---
  const [urlValue, setUrlValue] = useState('');
  const [pasteFallback, setPasteFallback] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const handleClipUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pasteFallback) {
      const payload = {
        text: pasteContent,
        source_format: 'note',
        title: null,
        blueprint_id: null,
        triage_status: 'inbox',
        collection_ids: [],
        tags: [],
        custom_fields: [],
      } as IngestTextRequest;
      try {
        const res = await ingestText(payload);
        setResult({ ok: !!res.item, msg: 'Pasted content saved.' });
        setPasteContent('');
      } catch (err) {
        setResult({ ok: false, msg: err instanceof Error ? err.message : 'Save failed.' });
      }
      return;
    }
    try {
      const res = await ingestUrl({ url: urlValue, title: null, blueprint_id: null, triage_status: 'inbox', collection_ids: [], tags: [], custom_fields: [], force_paste_fallback: false });
      if (!res.item) {
        setResult({ ok: false, msg: 'URL ingestion returned no item. Try pasting text instead.' });
        setPasteFallback(true);
        return;
      }
      setResult({ ok: true, msg: `Clipped "${res.item.title || 'item'}" successfully.` });
      setUrlValue('');
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Clip failed.' });
    }
  };

  // --- New Markdown Note tab ---
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const handleNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      text: content || title || '',
      source_format: 'note',
      title: title || null,
      blueprint_id: null,
      triage_status: 'inbox',
      collection_ids: [],
      tags: [],
      custom_fields: [],
    } as IngestTextRequest;
    try {
      const res = await ingestText(payload);
      if (res.item) {
        setResult({ ok: true, msg: `Note "${res.item.title || 'created'}" saved.` });
        setTitle('');
        setContent('');
      } else {
        setResult({ ok: false, msg: 'Note was not saved.' });
      }
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Save failed.' });
    }
  };

  return (
    <div className="fixed inset-0 z-[50]">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />

      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-xl border border-white/10 bg-[var(--surface)] text-[var(--font-reading)] p-6 shadow-2xl m-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Omni-Capture</h2>
          <button onClick={close} className="rounded p-1 opacity-50 hover:opacity-100">×</button>
        </div>

        <div className="flex gap-2 border-b border-white/10 mb-4 pb-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded px-3 py-2 text-sm transition-colors ${tab === t.id ? 'bg-[var(--accent)] text-black' : 'text-[var(--font-reading)]/80 hover:text-[var(--font-reading)]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Upload File */}
        {tab === 'file' && (
          <form onSubmit={handleUpload} className="space-y-3">
            <label className="block text-xs opacity-60 uppercase">Choose a file</label>
            <input
              type="file"
              accept=".pdf,.docx,.md,.txt,.html,.csv,.json"
              className="w-full rounded-lg border border-white/10 bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] || null)}
            />
            {loadingFormats ? <p className="text-xs opacity-60">Validating formats…</p> : null}
            <button
              type="submit"
              disabled={!file}
              className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-black disabled:opacity-50"
            >
              Upload
            </button>
          </form>
        )}

        {/* Clip URL */}
        {tab === 'url' && (
          <form onSubmit={handleClipUrl} className="space-y-3">
            {!pasteFallback ? (
              <>
                <label className="block text-xs opacity-60 uppercase">Paste article URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/article"
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
                <p className="text-xs opacity-60">
                  If the site blocks scraping, switch to "Paste Article / Transcript" below.
                </p>
                <button
                  type="button"
                  onClick={() => setPasteFallback(true)}
                  className="w-full rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2 text-sm text-[var(--font-reading)] hover:bg-white/5"
                >
                  Paste Article / Transcript
                </button>
              </>
            ) : (
              <>
                <label className="block text-xs opacity-60 uppercase">Paste article or transcript text</label>
                <textarea
                  placeholder="Paste text here…"
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-white/10 bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
                <p className="text-xs opacity-60">Saved as a new Markdown note.</p>
                <button
                  type="submit"
                  disabled={!pasteContent.trim()}
                  className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-black disabled:opacity-50"
                >
                  Save as Note
                </button>
              </>
            )}
          </form>
        )}

        {/* New Markdown Note */}
        {tab === 'note' && (
          <form onSubmit={handleNote} className="space-y-3">
            <div className="grid gap-3">
              <label className="block text-xs opacity-60 uppercase">Title</label>
              <input
                type="text"
                placeholder="Optional title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-lg border border-white/10 bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
              <label className="block text-xs opacity-60 uppercase">Content</label>
              <textarea
                placeholder="Write your note…"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                className="w-full rounded-lg border border-white/10 bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            </div>
            <button type="submit" className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-black">
              Create Note
            </button>
          </form>
        )}

        {result && (
          <div
            className={`mt-4 rounded-lg px-3 py-2 text-xs font-medium ${result.ok ? 'bg-green-900/20 border border-green-900/30 text-green-300' : 'bg-red-900/20 border border-red-900/30 text-red-300'}`}
          >
            {result.msg}
          </div>
        )}
      </div>
    </div>
  );
}
