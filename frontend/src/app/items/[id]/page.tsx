'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import Shell from '@/components/Shell';
import IntegrityBanner from '@/components/inspector/IntegrityBanner';
import InspectorDrawer from '@/components/inspector/InspectorDrawer';
import NoteEditor from '@/components/inspector/NoteEditor';
import PdfViewer from '@/components/inspector/PdfViewer';
import SegmentReader from '@/components/inspector/SegmentReader';
import BlueprintPanel from '@/components/inspector/BlueprintPanel';
import LinkPanel from '@/components/inspector/LinkPanel';
import {
  getBlueprints,
  getCollections,
  getItem,
  getPromptTemplates,
  getRelationTypes,
  getTags,
  setProgress,
} from '@/lib/api';
import type {
  Blueprint,
  Collection,
  ItemDetail,
  PromptTemplate,
  RelationType,
  Segment,
  Tag,
} from '@/lib/types';

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

  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeSegment, setActiveSegment] = useState<number | null>(initialSegment);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
        setActiveSegment((current) => current ?? (stored >= 1 ? stored : null));
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
        /* drawer degrades to triage + export only */
      });
  }, []);

  // Persist the reading position, but only when it actually moved.
  const recordProgress = useCallback(
    (segmentIndex: number, label?: string) => {
      if (!itemId || lastSaved.current === segmentIndex) return;
      lastSaved.current = segmentIndex;
      setProgress(itemId, {
        segment_index: segmentIndex,
        ...(label ? { segment_label: label } : {}),
      }).catch(() => {
        lastSaved.current = null;
      });
    },
    [itemId]
  );

  const onSegment = (segment: Segment) => {
    setActiveSegment(segment.segment_index);
    recordProgress(segment.segment_index, segment.segment_label);
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
  const segments = item.segments ?? [];

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase opacity-50">
              <span>{item.source_format.replace(/_/g, ' ')}</span>
              <span>·</span>
              <span>{item.triage_status.replace(/_/g, ' ')}</span>
              <span>·</span>
              <span>{item.est_read_minutes} min</span>
              {item.word_count ? (
                <>
                  <span>·</span>
                  <span>{item.word_count} words</span>
                </>
              ) : null}
            </div>
            <h1 className="text-lg font-semibold leading-snug">{item.title}</h1>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen((value) => !value)}
            className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs lg:hidden"
          >
            {drawerOpen ? 'Close' : 'Manage'}
          </button>
        </div>

        <IntegrityBanner
          integrity={item.integrity}
          onJump={(index) => {
            setActiveSegment(index);
            recordProgress(index);
            document.getElementById(`segment-${index}`)?.scrollIntoView({ block: 'start' });
          }}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            {isPdf ? (
              <PdfViewer
                itemId={item.id}
                initialPage={activeSegment ?? 1}
                onPageChange={(page) => {
                  setActiveSegment(page);
                  recordProgress(page);
                }}
              />
            ) : item.source_format === 'note' || item.source_format === 'markdown' ? (
              <NoteEditor item={item} onSaved={(updated) => setItem(updated)} />
            ) : (
              <SegmentReader
                segments={segments}
                activeIndex={activeSegment}
                onSelect={onSegment}
              />
            )}

            {item.source_format === 'web_article' && item.snapshot_uri ? (
              <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] opacity-60">
                Archival snapshot kept at capture time — the live page may have changed.
              </p>
            ) : null}

            {segments.length > 0 && isPdf ? (
              <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <summary className="cursor-pointer text-xs opacity-60">
                  Extracted text ({segments.length} pages)
                </summary>
                <div className="mt-3">
                  <SegmentReader
                    segments={segments}
                    activeIndex={activeSegment}
                    onSelect={onSegment}
                  />
                </div>
              </details>
            ) : null}
          </div>

          <div className={drawerOpen ? 'block' : 'hidden lg:block'}>
            <div className="space-y-5">
              <InspectorDrawer
                item={item}
                collections={collections}
                tags={tags}
                prompts={prompts}
                onChanged={load}
                onDeleted={() => router.push('/library')}
              />
              <div className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <BlueprintPanel item={item} blueprints={blueprints} onChanged={load} />
                <LinkPanel item={item} relationTypes={relations} onChanged={load} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
