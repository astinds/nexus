"""Search: predicate construction and the documented fallback mode.

The SQL itself needs a live PostgreSQL (`websearch_to_tsquery`, `ts_headline`); these
tests pin the query shape, the binding of user input, and the facet dimensions so a
regression in the builder is caught without a database.
"""

from __future__ import annotations

from uuid import UUID

from app.models import SourceFormat, TriageStatus
from app.services.search import HEADLINE_OPTIONS, _predicate

WORKSPACE = UUID("11111111-1111-1111-1111-111111111111")
COLLECTION = UUID("22222222-2222-2222-2222-222222222222")


def test_query_text_is_bound_not_interpolated() -> None:
    predicate = _predicate(
        "'; drop table items; --",
        workspace_id=None,
        source_format=None,
        blueprint_id=None,
        triage_status=None,
        collection_id=None,
        tag=None,
    )
    sql = predicate.where()
    assert "drop table" not in sql.lower()
    assert "websearch_to_tsquery('english', %(q)s)" in sql
    assert predicate.params["q"] == "'; drop table items; --"


def test_empty_query_has_no_text_predicate() -> None:
    predicate = _predicate(
        None,
        workspace_id=None,
        source_format=None,
        blueprint_id=None,
        triage_status=None,
        collection_id=None,
        tag=None,
    )
    assert predicate.where() == ""


def test_filters_are_combined_with_and() -> None:
    predicate = _predicate(
        "cooling",
        workspace_id=WORKSPACE,
        source_format=SourceFormat.pdf,
        blueprint_id=None,
        triage_status=TriageStatus.reading,
        collection_id=COLLECTION,
        tag="climate",
    )
    sql = predicate.where()
    assert sql.startswith(" where ")
    assert "websearch_to_tsquery" in sql
    assert "i.workspace_id = %(p" in sql
    assert "i.source_format = %(p" in sql
    assert "i.triage_status = %(p" in sql
    assert "nexus_collection_tree" in sql
    assert "unnest(t.aliases)" in sql


def test_tag_filter_matches_aliases() -> None:
    predicate = _predicate(
        None,
        workspace_id=None,
        source_format=None,
        blueprint_id=None,
        triage_status=None,
        collection_id=None,
        tag="AI",
    )
    assert "lower(%(tag)s) = any(select lower(a) from unnest(t.aliases) a)" in predicate.where()
    assert predicate.params["tag"] == "AI"


def test_headline_options_are_bounded_for_mobile() -> None:
    assert "MaxWords=34" in HEADLINE_OPTIONS
    assert "MaxFragments=1" in HEADLINE_OPTIONS
    assert "<mark>" in HEADLINE_OPTIONS


def test_source_format_enum_values_are_used_directly() -> None:
    predicate = _predicate(
        None,
        workspace_id=None,
        source_format=SourceFormat.web_article,
        blueprint_id=None,
        triage_status=None,
        collection_id=None,
        tag=None,
    )
    assert "web_article" in predicate.params.values()
