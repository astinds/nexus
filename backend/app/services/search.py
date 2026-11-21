"""PostgreSQL full-text search across item segments.

Why this shape:
  * `websearch_to_tsquery` accepts what people actually type ("policy AND climate")
    without raising on syntax errors, unlike `to_tsquery`.
  * `ts_headline` produces the snippet server-side, so a mobile client never has to
    download full segment bodies to show a preview.
  * Facets are computed from the same predicate in one extra query each, keeping the
    response useful without a second round trip.

When the query yields no lexemes (punctuation only), the service degrades to an ILIKE
scan and reports `mode: "fallback"` rather than pretending nothing matched.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg

from ..models import (
    LibraryFilters,
    SearchHit,
    SearchResponse,
    SourceFormat,
    TriageStatus,
    clamp_limit,
    clamp_offset,
)
from ..repositories.base import Query, fetch_all, fetch_one

# ts_headline options: one fragment, short enough for a phone card.
HEADLINE_OPTIONS = "StartSel=<mark>, StopSel=</mark>, MaxWords=34, MinWords=12, MaxFragments=1"


def _predicate(
    q: str | None,
    *,
    workspace_id: UUID | None,
    source_format: SourceFormat | None,
    blueprint_id: UUID | None,
    triage_status: TriageStatus | None,
    collection_id: UUID | None,
    tag: str | None,
) -> Query:
    query = Query()
    if q:
        query.raw("s.search_vector @@ websearch_to_tsquery('english', %(q)s)", q=q)
    query.eq("i.workspace_id", workspace_id, cast="uuid")
    if source_format:
        query.eq("i.source_format", source_format.value)
    query.eq("i.blueprint_id", blueprint_id, cast="uuid")
    if triage_status:
        query.eq("i.triage_status", triage_status.value)
    if tag:
        query.raw(
            "exists (select 1 from item_tags it join tags t on t.id = it.tag_id "
            "where it.item_id = i.id and (lower(t.name) = lower(%(tag)s) "
            "or lower(%(tag)s) = any(select lower(a) from unnest(t.aliases) a)))",
            tag=tag.strip(),
        )
    if collection_id:
        query.raw(
            "exists (select 1 from item_collections ic where ic.item_id = i.id "
            "and ic.collection_id in (select id from nexus_collection_tree(%(collection_id)s::uuid)))",
            collection_id=str(collection_id),
        )
    return query


def search(
    cur: psycopg.Cursor,
    *,
    q: str,
    workspace_id: UUID | None = None,
    source_format: SourceFormat | None = None,
    blueprint_id: UUID | None = None,
    triage_status: TriageStatus | None = None,
    collection_id: UUID | None = None,
    tag: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> SearchResponse:
    limit, offset = clamp_limit(limit), clamp_offset(offset)
    cleaned = (q or "").strip()
    predicate = _predicate(
        cleaned or None,
        workspace_id=workspace_id,
        source_format=source_format,
        blueprint_id=blueprint_id,
        triage_status=triage_status,
        collection_id=collection_id,
        tag=tag,
    )

    mode: str = "fulltext"
    ranking = "0::float4"
    snippet_expr = "left(s.content, 240)"

    if cleaned:
        probe = fetch_one(
            cur,
            "select websearch_to_tsquery('english', %(q)s)::text as tsq",
            {"q": cleaned},
        ) or {}
        lexemes = (probe.get("tsq") or "").strip()
        if lexemes:
            ranking = "ts_rank_cd(s.search_vector, websearch_to_tsquery('english', %(q)s))"
            snippet_expr = (
                "ts_headline('english', s.content, "
                f"websearch_to_tsquery('english', %(q)s), '{HEADLINE_OPTIONS}')"
            )
            predicate.params["q"] = cleaned
        else:
            # Punctuation-only queries: fall back to substring matching, and say so.
            mode = "fallback"
            predicate.clauses = [
                clause for clause in predicate.clauses if "%(q)s" not in clause
            ]
            predicate.params.pop("q", None)
            predicate.ilike("s.content", cleaned)
            snippet_expr = "left(s.content, 240)"

    where = predicate.where()
    total = int(
        (
            fetch_one(
                cur,
                f"select count(*) as n from item_segments s join items i on i.id = s.item_id{where}",
                predicate.params,
            )
            or {"n": 0}
        )["n"]
    )

    sql = (
        "select s.id as segment_id, s.segment_index, s.segment_label, "
        f"       {snippet_expr} as snippet, {ranking} as rank, "
        "       i.id as item_id, i.title, i.source_format, i.triage_status, i.est_read_minutes "
        "from item_segments s join items i on i.id = s.item_id"
        f"{where} "
        + (
            "order by rank desc, i.updated_at desc "
            if ranking != "0::float4"
            else "order by i.updated_at desc "
        )
        + "limit %(limit)s offset %(offset)s"
    )
    rows = fetch_all(cur, sql, {**predicate.params, "limit": limit, "offset": offset})

    hits = [
        SearchHit(
            item_id=row["item_id"],
            title=row["title"],
            source_format=row["source_format"],
            triage_status=row["triage_status"],
            est_read_minutes=row["est_read_minutes"] or 0,
            segment_id=row["segment_id"],
            segment_index=row["segment_index"],
            segment_label=row["segment_label"],
            snippet=row["snippet"] or "",
            rank=float(row["rank"] or 0.0),
        )
        for row in rows
    ]

    return SearchResponse(
        query=cleaned,
        mode=mode,  # type: ignore[arg-type]
        hits=hits,
        total=total,
        limit=limit,
        offset=offset,
        facets=_facets(cur, predicate.params, where, cleaned),
    )


def _facets(cur: psycopg.Cursor, params: dict[str, Any], where: str, q: str) -> dict[str, dict[str, int]]:
    """Counts for the filter rail, computed over the same result set."""
    facets: dict[str, dict[str, int]] = {}
    dimensions = {
        "source_format": "i.source_format",
        "triage_status": "i.triage_status",
    }
    for name, column in dimensions.items():
        rows = fetch_all(
            cur,
            f"select {column} as key, count(*) as n from item_segments s "
            f"join items i on i.id = s.item_id{where} group by 1 order by 2 desc",
            params,
        )
        facets[name] = {str(row["key"]): int(row["n"]) for row in rows}

    rows = fetch_all(
        cur,
        "select t.name as key, count(*) as n from item_segments s "
        "join items i on i.id = s.item_id "
        "join item_tags it on it.item_id = i.id join tags t on t.id = it.tag_id"
        f"{where} group by 1 order by 2 desc limit 30",
        params,
    )
    facets["tag"] = {str(row["key"]): int(row["n"]) for row in rows}
    return facets


def search_items(
    cur: psycopg.Cursor, filters: LibraryFilters
) -> SearchResponse:
    """Convenience wrapper used by GET /search when only item-level filters matter."""
    return search(
        cur,
        q=filters.q or "",
        workspace_id=filters.workspace_id,
        source_format=filters.source_format,
        blueprint_id=filters.blueprint_id,
        triage_status=filters.triage_status,
        collection_id=filters.collection_id,
        tag=filters.tag,
        limit=filters.limit,
        offset=filters.offset,
    )
