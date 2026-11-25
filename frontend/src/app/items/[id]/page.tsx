'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import Shell from '@/components/Shell';
import MarkdownView from '@/components/MarkdownView';
import IntegrityPill from '@/components/inspector/IntegrityPill';
import ManageSheet from '@/components/inspector/ManageSheet';
import NoteEditor from '@/components/inspector/NoteEditor';
import PdfViewer from '@/components/inspector/PdfViewer';
import ReflowView from '@/components/reader/ReflowView';
import NotesSheet from '@/components/reader/NotesSheet';
import {
  getBlueprints,
  getCollections,
  getItem,
  getPromptTemplates,
  getRelationTypes,
  getTags,
  setProgress,
  setTriage,
} from '@/lib/api';
import { formatCount, durationLabel, plural, triageLabel, triageTone } from '@/lib/format';
import { pageLabel } from '@/lib/reader';
import type {
  Blueprint,
  Collection,
  ItemDetail,
  PromptTemplate,
  RelationType,
  Tag,
  TriageStatus,
} from '@/lib/types';

const NEXT_TRIAGE: Record<string, TriageStatus> = {
  inbox: 'reading',
  reading: 'processed',
  processed: 'inbox',
  evergreen: 'processed',
  cold_archive: 'inbox',
};

export default function ItemPage() {
  return (
    <Suspense
      fallback={<p className="px-6 py-16 text-center text-sm opacity-50">Loading item…</p>}
    >
      <ItemView />
    </Suspense>
  );
}

function ItemView() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const itemId = params.id;

  const initialSegment = useMemo(() => {
    const raw = search.get('segment') ?? search.get('page');
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
  }, [search]);
  const highlight = (search.get('q') ?? '').trim();

  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<number>(initialSegment ?? 1);
  const [mode, setMode] = useState<'reflow' | 'pdf'>('reflow');
  const [focus, setFocus] = useState(false);
  const [hudVisible, setHudVisible] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [relations, setRelations] = useState<RelationType[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);

  const lastSaved = useRef<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getItem(itemId)
      .then((detail) => {
        setItem(detail);
        setError('');
        const stored = Number(detail.reading_progress?.segment_index ?? 0);
        setPage((current) => (current > 1 ? current : stored >= 1 ? stored : 1));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Item unavailable'))
      .finally(() => setLoading(false));
  }, [itemId]);

  useEffect(load, [load]);

  useEffect(() => {
    Promise.all([
      getBlueprints(),
      getCollections(),
      getTags(),
      getRelationTypes(),
      getPromptTemplates(),
    ])
      .then(([bps, cols, tgs, rels, prs]) => {
        setBlueprints(bps);
        setCollections(cols);
        setTags(tgs);
        setRelations(rels);
        setPrompts(prs);
      })
      .catch(() => {
        /* the sheet degrades to triage + export only */
      });
  }, []);

  // Persist the position, debounced: turning pages quickly should not queue a
  // request per page, but leaving mid-chapter must still resume exactly there.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordProgress = useCallback(
    (pageNumber: number, label?: string) => {
      if (!itemId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (lastSaved.current === pageNumber) return;
        lastSaved.current = pageNumber;
        setProgress(itemId, {
          segment_index: pageNumber,
          segment_label: label ?? `Page ${pageNumber}`,
        }).catch(() => {
          lastSaved.current = null;
        });
      }, 900);
    },
    [itemId],
  );

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const changePage = useCallback(
    (next: number) => {
      setPage(next);
      recordProgress(next);
    },
    [recordProgress],
  );

  // Keyboard: N toggles notes, F toggles focus, arrows turn pages.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'n' || event.key === 'N') setNotesOpen((value) => !value);
      if (event.key === 'f' || event.key === 'F') setFocus((value) => !value);
      if (event.key === 'ArrowRight') changePage(page + 1);
      if (event.key === 'ArrowLeft') changePage(Math.max(1, page - 1));
      if (event.key === 'Escape') {
        setFocus(false);
        setHudVisible(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changePage, page]);

  const cycleTriage = async () => {
    if (!item) return;
    const next = NEXT_TRIAGE[item.triage_status] ?? 'reading';
    try {
      const updated = await setTriage(item.id, next);
      setItem({ ...item, triage_status: updated.triage_status });
    } catch {
      /* pill reverts on reload; no modal for a failed tap */
    }
  };

  if (loading && !item) {
    return (
      <Shell>
        <p className="py-16 text-center text-sm opacity-50">Loading item…</p>
      </Shell>
    );
  }

  if (error || !item) {
    return (
      <Shell>
        <div className="space-y-3 py-16 text-center">
          <p className="text-sm opacity-70">{error || 'Item not found.'}</p>
          <Link href="/library" className="text-xs underline underline-offset-2">
            Back to library
          </Link>
        </div>
      </Shell>
    );
  }

  const isPdf = item.source_format === 'pdf';
  const isNote = item.source_format === 'note' || item.source_format === 'markdown';
  const isMarkdownArticle = item.source_format === 'web_article';
  const segments = item.segments ?? [];
  const total = segments.length || 1;

  const reader = (
    <div className="space-y-4">
      {isPdf && mode === 'pdf' ? (
        <PdfViewer
          itemId={item.id}
          initialPage={page}
          onPageChange={changePage}
          showDownload={false}
        />
      ) : isPdf ? (
        <ReflowView segments={segments} page={page} onPage={changePage} highlight={highlight} />
      ) : isNote ? (
        <NoteEditor item={item} onSaved={(updated) => setItem(updated)} />
      ) : isMarkdownArticle ? (
        <MarkdownView source={segments.map((segment) => segment.content).join('\n\n')} />
      ) : (
        <div className="space-y-6">
          {segments.map((segment) => (
            <article key={segment.id} id={`segment-${segment.segment_index}`} className="prose-reading">
              {segments.length > 1 ? (
                <p className="mb-1 text-[10px] uppercase tracking-wider opacity-40">
                  {segment.segment_label}
                </p>
              ) : null}
              <p className="whitespace-pre-line text-[15px]">{segment.content}</p>
            </article>
          ))}
          {segments.length === 0 ? (
            <p className="text-sm opacity-60">No extracted text yet.</p>
          ) : null}
        </div>
      )}
    </div>
  );

  const header = (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider opacity-50">
            <span>{formatCount(item.word_count ?? 0)} words</span>
            <span>·</span>
            <span>{durationLabel(item.est_read_minutes) ?? '—'}</span>
            {item.integrity && item.integrity.scanned > 0 ? (
              <>
                <span>·</span>
                <span>{plural(item.integrity.scanned, 'scanned page')}</span>
              </>
            ) : null}
          </div>
          <h1 className="text-lg font-semibold leading-snug">{item.title}</h1>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void cycleTriage()}
            title="Tap to move Inbox → Reading → Done"
            className={`badge ${triageTone(item.triage_status)} rounded-full px-2.5 py-1 text-[11px]`}
          >
            {triageLabel(item.triage_status)}
          </button>
          <button
            type="button"
            onClick={() => setFocus(true)}
            aria-label="Focus reading mode"
            className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs"
          >
            ⤢
          </button>
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs"
          >
            Manage
          </button>
        </div>
      </div>

      {isPdf ? (
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-full border border-[var(--border)] text-[11px]">
            <button
              type="button"
              onClick={() => setMode('reflow')}
              aria-pressed={mode === 'reflow'}
              className={`px-3 py-1 ${mode === 'reflow' ? 'bg-[var(--accent)] text-black' : ''}`}
            >
              Reflow
            </button>
            <button
              type="button"
              onClick={() => setMode('pdf')}
              aria-pressed={mode === 'pdf'}
              className={`px-3 py-1 ${mode === 'pdf' ? 'bg-[var(--accent)] text-black' : ''}`}
            >
              PDF
            </button>
          </div>
          <span className="text-[11px] tabular-nums opacity-50">
            {pageLabel(page, total)}
          </span>
        </div>
      ) : null}

      <IntegrityPill
        integrity={item.integrity}
        onJump={(index) => {
          setMode('reflow');
          changePage(index);
        }}
      />
    </div>
  );

  const hud = (
    <div className="pointer-events-auto mx-auto flex max-w-md flex-wrap items-center justify-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)]/95 px-2 py-1.5 text-[11px] shadow-lg backdrop-blur">
      <button type="button" onClick={() => setFocus(false)} className="px-2 py-1" aria-label="Exit focus">
        ✕
      </button>
      {isPdf ? (
        <>
          <button
            type="button"
            onClick={() => setMode(mode === 'reflow' ? 'pdf' : 'reflow')}
            className="rounded-full bg-[var(--surface-2)] px-2 py-1 capitalize"
          >
            {mode}
          </button>
          <input
            type="range"
            min={1}
            max={total}
            value={page}
            onChange={(event) => changePage(Number(event.target.value))}
            aria-label="Page scrubber"
            className="h-1 w-24 accent-[var(--accent)]"
          />
          <span className="tabular-nums opacity-60">{page}</span>
        </>
      ) : null}
      <button type="button" onClick={() => setNotesOpen(true)} className="px-2 py-1" aria-label="Notes">
        Notes
      </button>
      <button type="button" onClick={() => setManageOpen(true)} className="px-2 py-1">
        Manage
      </button>
    </div>
  );

  return (
    <Shell>
      <div className="space-y-4">
        {header}
        <div className="mx-auto max-w-[75ch]">{reader}</div>
      </div>

      {focus ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-[var(--background)]">
          <div
            className="flex-1 overflow-y-auto px-3 py-4"
            onClick={(event) => {
              if (event.target === event.currentTarget) setHudVisible((value) => !value);
            }}
          >
            <div className="mx-auto max-w-[75ch]">
              <h1 className="mb-3 text-sm font-semibold opacity-70">{item.title}</h1>
              {reader}
            </div>
          </div>
          {hudVisible ? <div className="p-3">{hud}</div> : null}
        </div>
      ) : null}

      <ManageSheet
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        item={item}
        collections={collections}
        tags={tags}
        prompts={prompts}
        blueprints={blueprints}
        relationTypes={relations}
        onChanged={load}
        onDeleted={() => router.push('/library')}
      />

      <NotesSheet
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        itemId={item.id}
        page={page}
        quote={highlight}
        onJump={(target) => {
          setNotesOpen(false);
          setMode('reflow');
          changePage(target);
        }}
      />
    </Shell>
  );
}
