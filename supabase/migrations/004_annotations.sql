-- NEXUS v1.0 -- 004 annotations
-- Page-anchored reader notes and highlights. Idempotent.
--
-- Why a separate table instead of a column:
--   * one page can hold many notes, in any order, without rewriting the segment;
--   * a highlight quotes text that may later change upstream, so the quote is
--     stored verbatim (quote_text) and never resolved against current content;
--   * the reader filter is "this page" vs "all pages", which is a cheap
--     (item_id, segment_index) index rather than a scan of item metadata.
--
-- segment_index is 1-based and nullable: a note may be item-wide rather than
-- attached to a page (e.g. a general remark about the source).

begin;

create table if not exists annotations (
    id             uuid primary key default gen_random_uuid(),
    item_id        uuid not null references items(id) on delete cascade,
    segment_index  int check (segment_index is null or segment_index >= 1),
    segment_label  text,
    quote_text     text,
    note_body      text not null default '',
    color          varchar(16) not null default 'default',
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    -- An annotation must carry something: a quote, a note, or both.
    constraint annotations_content_present
        check (length(btrim(coalesce(note_body, ''))) > 0
               or length(btrim(coalesce(quote_text, ''))) > 0)
);

create index if not exists annotations_item_idx
    on annotations (item_id, segment_index nulls first, created_at);
create index if not exists annotations_item_created_idx
    on annotations (item_id, created_at desc);

-- Reuse the function created in 002; attaching here keeps the new table honest
-- without editing an already-applied migration.
drop trigger if exists annotations_touch_updated_at on annotations;
create trigger annotations_touch_updated_at
    before update on annotations
    for each row execute function nexus_touch_updated_at();

commit;
