-- NEXUS v1.0 -- 001 initial schema
-- Target: PostgreSQL 13+ (Supabase Free is PG15+). Every statement is idempotent,
-- so `python scripts/apply_migrations.py` can re-run the whole set safely.
--
-- Invariants encoded here:
--   * source_format is the immutable container (pdf, docx, markdown, text, csv,
--     json, web_article, note). blueprint_id is the user's conceptual schema
--     (Book, Research Paper, Policy Brief, ...). They are independent columns.
--   * No file binaries in Postgres: bytes live in Storage and are referenced by
--     URI (source_uri = original, snapshot_uri = preserved archive for web clips).
--   * item_segments carries the tsvector used for search; one row per page,
--     section or note body, with 1-based ordering in segment_index.

begin;

-- ------------------------------------------------------------------ 0. bookkeeping
create table if not exists schema_migrations (
    version     text primary key,
    checksum    text not null default '',
    applied_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ 1. workspaces
create table if not exists workspaces (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    slug        text not null unique,
    description text,
    is_default  boolean not null default false,
    created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ 2. metadata_blueprints
-- fields_schema shape: {"fields": [{"key","label","type","options"?,"default"?,"required"?}]}
-- with type in text|number|date|select|boolean|url. Validated by the API layer.
create table if not exists metadata_blueprints (
    id               uuid primary key default gen_random_uuid(),
    name             text not null unique,
    description      text,
    default_formats  text[] not null default '{}',
    fields_schema    jsonb not null default '{"fields": []}'::jsonb,
    created_at       timestamptz not null default now()
);

-- ------------------------------------------------------------------ 3. collections (PARA-capable, hierarchical)
create table if not exists collections (
    id           uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    name         text not null,
    description  text,
    para_type    text check (para_type in ('project', 'area', 'resource', 'archive')),
    parent_id    uuid references collections(id) on delete set null,
    created_at   timestamptz not null default now()
);
create index if not exists collections_workspace_idx on collections (workspace_id);
create index if not exists collections_parent_idx on collections (parent_id);
create unique index if not exists collections_unique_sibling_idx
    on collections (workspace_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- ------------------------------------------------------------------ 4. tags
create table if not exists tags (
    id         uuid primary key default gen_random_uuid(),
    name       text not null unique,
    aliases    text[] not null default '{}',
    created_at timestamptz not null default now()
);
create index if not exists tags_aliases_idx on tags using gin (aliases);

-- ------------------------------------------------------------------ 5. items
create table if not exists items (
    id                 uuid primary key default gen_random_uuid(),
    workspace_id       uuid not null references workspaces(id) on delete cascade,
    blueprint_id       uuid references metadata_blueprints(id) on delete set null,
    title              text not null,
    source_format      text not null,
    source_uri         text,
    snapshot_uri       text,
    mime_type          text,
    file_size          bigint,
    word_count         integer not null default 0,
    est_read_minutes   integer not null default 0,
    content_hash       text,
    processing_status  text not null default 'pending'
        check (processing_status in ('pending','processing','ready','partial','needs_enrichment','failed')),
    triage_status      text not null default 'inbox'
        check (triage_status in ('inbox','reading','processed','evergreen','cold_archive')),
    reading_progress   jsonb not null default '{}'::jsonb,
    error_message      text,
    summary            text,
    custom_fields      jsonb not null default '{}'::jsonb,
    metadata           jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists items_workspace_idx        on items (workspace_id);
create index if not exists items_blueprint_idx        on items (blueprint_id);
create index if not exists items_format_idx           on items (source_format);
create index if not exists items_triage_idx           on items (triage_status);
create index if not exists items_processing_idx       on items (processing_status);
create index if not exists items_created_idx          on items (created_at desc);
create index if not exists items_reading_minutes_idx  on items (est_read_minutes);
-- content_hash is not globally unique: the same bytes may legitimately serve two
-- workspaces. Uniqueness is enforced per (workspace_id, content_hash) instead.
create unique index if not exists items_workspace_hash_key
    on items (workspace_id, content_hash) where content_hash is not null;
create index if not exists items_title_trgm_idx       on items (lower(title));

create table if not exists item_collections (
    item_id       uuid not null references items(id) on delete cascade,
    collection_id uuid not null references collections(id) on delete cascade,
    created_at    timestamptz not null default now(),
    primary key (item_id, collection_id)
);
create index if not exists item_collections_collection_idx on item_collections (collection_id);

create table if not exists item_tags (
    item_id    uuid not null references items(id) on delete cascade,
    tag_id     uuid not null references tags(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (item_id, tag_id)
);
create index if not exists item_tags_tag_idx on item_tags (tag_id);

-- ------------------------------------------------------------------ 6. item_segments
-- search_vector is a generated column: it is always in sync, so no trigger and
-- no backfill step is ever needed. A future v1.2 `embedding vector(1536)` column
-- plus an ivfflat index can be added by a new numbered migration without
-- touching anything here.
create table if not exists item_segments (
    id                uuid primary key default gen_random_uuid(),
    item_id           uuid not null references items(id) on delete cascade,
    segment_index     integer not null,
    segment_label     text not null,
    content           text not null default '',
    is_scanned        boolean not null default false,
    extraction_status text not null default 'ok'
        check (extraction_status in ('ok','empty','scanned','failed','skipped')),
    metadata          jsonb not null default '{}'::jsonb,
    search_vector     tsvector generated always as
        (to_tsvector('english', coalesce(content, ''))) stored,
    created_at        timestamptz not null default now(),
    unique (item_id, segment_index)
);
create index if not exists item_segments_item_idx   on item_segments (item_id, segment_index);
create index if not exists item_segments_search_idx on item_segments using gin (search_vector);
create index if not exists item_segments_scanned_idx on item_segments (item_id) where is_scanned;

-- ------------------------------------------------------------------ 7. relation types + typed links
create table if not exists relation_types (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    description text,
    is_seeded   boolean not null default false,
    created_at  timestamptz not null default now()
);

create table if not exists item_links (
    id                 uuid primary key default gen_random_uuid(),
    source_item_id     uuid not null references items(id) on delete cascade,
    target_item_id     uuid not null references items(id) on delete cascade,
    relation_type_id   uuid not null references relation_types(id) on delete restrict,
    source_segment_id  uuid references item_segments(id) on delete set null,
    note               text,
    created_at         timestamptz not null default now(),
    check (source_item_id <> target_item_id)
);
create index if not exists item_links_source_idx on item_links (source_item_id);
create index if not exists item_links_target_idx on item_links (target_item_id);
create unique index if not exists item_links_unique_idx
    on item_links (source_item_id, target_item_id, relation_type_id);

-- ------------------------------------------------------------------ 8. saved views, prompts, preferences, activity
create table if not exists saved_views (
    id           uuid primary key default gen_random_uuid(),
    workspace_id uuid references workspaces(id) on delete cascade,
    name         text not null,
    kind         text not null default 'library' check (kind in ('library', 'search')),
    config       jsonb not null default '{}'::jsonb,
    is_pinned    boolean not null default false,
    created_at   timestamptz not null default now()
);
create index if not exists saved_views_pinned_idx on saved_views (is_pinned, created_at desc);

create table if not exists prompt_templates (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    body        text not null,
    description text,
    created_at  timestamptz not null default now()
);

-- Singleton row: live typography / dark palette / reading width preferences.
create table if not exists user_preferences (
    id         smallint primary key default 1 check (id = 1),
    payload    jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create table if not exists activity_logs (
    id         uuid primary key default gen_random_uuid(),
    item_id    uuid references items(id) on delete cascade,
    kind       text not null,
    message    text not null default '',
    metadata   jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists activity_logs_created_idx on activity_logs (created_at desc);

-- ------------------------------------------------------------------ seeds (idempotent)
insert into workspaces (name, slug, description, is_default)
values ('Personal', 'personal', 'Default NEXUS workspace', true)
on conflict (slug) do nothing;

insert into relation_types (name, description, is_seeded) values
    ('relates_to',   'Generic association',            true),
    ('supports',     'Source A provides evidence for B', true),
    ('contradicts',  'Source A argues against B',      true),
    ('extends',      'Source A builds on B',           true),
    ('cites',        'Source A cites B',               true),
    ('example_of',   'Source A is an example of B',    true),
    ('derived_from', 'Source A was produced from B',   true)
on conflict (name) do nothing;

insert into user_preferences (id) values (1) on conflict (id) do nothing;

insert into prompt_templates (name, body, description) values
    ('Critique', 'Critique the following source. List its strongest claim, the evidence behind it, its weakest assumption, and one thing it leaves unanswered.',
     'Sharp three-part critique with a gap analysis.'),
    ('Extract claims', 'Extract every factual claim from the source below as a bullet list. Mark each claim as [supported], [unsupported] or [opinion].',
     'Claim inventory for literature review.'),
    ('Concept note', 'Turn the source below into a one-page concept note: problem, insight, mechanism, evidence, open questions.',
     'Condense a long source into a structured note.')
on conflict (name) do nothing;

commit;
