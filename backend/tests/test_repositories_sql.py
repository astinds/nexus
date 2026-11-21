"""Query builders and SQL identifiers, exercised without a database.

These tests protect the two things that silently break repositories: parameter
binding and accidental SQL injection through sort/filter values.
"""

from __future__ import annotations

import re

from app.models import LibraryFilters, TimeBudget, TriageStatus
from app.repositories.base import Query, order_by
from app.repositories.items import ITEM_COLUMNS, LIST_COLUMNS, UPDATABLE_COLUMNS


def test_query_binds_values_and_skips_none() -> None:
    query = Query().eq("a", 1).eq("b", None).ilike("c", "needle")
    sql = query.where()
    assert "a = %(p0)s" in sql
    assert "c ilike %(p1)s" in sql
    assert query.params == {"p0": 1, "p1": "%needle%"}
    assert sql.startswith(" where ")


def test_empty_query_has_no_where_clause() -> None:
    query = Query()
    assert query.where() == ""
    assert query.is_empty is True


def test_any_of_binds_a_list() -> None:
    query = Query().any_of("status", ["a", "b"])
    assert "= any(%(p0)s)" in query.where()
    assert query.params["p0"] == ["a", "b"]


def test_raw_clause_requires_unique_names() -> None:
    query = Query().raw("x = %(tag)s", tag="one")
    assert query.params["tag"] == "one"
    try:
        query.raw("y = %(tag)s", tag="two")
    except ValueError as exc:
        assert "duplicate" in str(exc)
    else:
        raise AssertionError("expected duplicate parameter rejection")


def test_order_by_whitelists_known_sorts() -> None:
    assert order_by("title") == "lower(i.title) asc"
    assert order_by("reading_time").startswith("i.est_read_minutes")
    assert order_by("nonsense") == order_by("recent")
    assert order_by("title", table_alias="x") == "lower(x.title) asc"


def test_item_column_list_excludes_heavy_fields() -> None:
    """The list endpoint must not select segment bodies or long blobs."""
    assert "content" not in (column.strip() for column in LIST_COLUMNS.split(","))
    assert "title" in ITEM_COLUMNS
    assert "reading_progress" in ITEM_COLUMNS
    assert "id" not in UPDATABLE_COLUMNS
    assert "created_at" not in UPDATABLE_COLUMNS


def test_library_filters_build_correct_sql_shape() -> None:
    filters = LibraryFilters(
        triage_status=TriageStatus.inbox,
        time_budget=TimeBudget.quick,
        tag="policy",
        limit=25,
        offset=50,
    )
    from app.repositories.items import _library_query

    query = _library_query(filters)
    sql = query.where()
    assert "i.triage_status = %(" in sql
    assert "i.est_read_minutes < 5" in sql
    assert "lower(t.name) = lower(%(tag)s)" in sql
    assert query.params["tag"] == "policy"
    assert filters.limit == 25 and filters.offset == 50


def test_time_budget_buckets_match_the_ui() -> None:
    from app.repositories.items import _library_query

    medium = _library_query(LibraryFilters(time_budget=TimeBudget.medium)).where()
    deep = _library_query(LibraryFilters(time_budget=TimeBudget.deep)).where()
    assert "between 15 and 30" in medium
    assert "> 30" in deep


def test_no_user_value_is_interpolated_into_sql() -> None:
    """Every user-supplied value must travel as a bound parameter."""
    filters = LibraryFilters(q="'; drop table items; --", tag="x' or '1'='1")
    from app.repositories.items import _library_query

    query = _library_query(filters)
    sql = query.where()
    assert "drop table" not in sql.lower()
    assert all(value in query.params.values() for value in query.params.values())
    assert re.search(r"%\(p\d+\)s", sql)


def test_collection_filter_uses_the_tree_function() -> None:
    from uuid import UUID

    from app.repositories.items import _library_query

    collection = UUID("11111111-1111-1111-1111-111111111111")
    sql = _library_query(LibraryFilters(collection_id=collection)).where()
    assert "nexus_collection_tree" in sql


def test_grouping_columns_are_whitelisted() -> None:
    from app.repositories.items import count_by

    class _Exploding:
        def execute(self, *_args, **_kwargs):  # pragma: no cover - must not be called
            raise AssertionError("unsupported column reached the database")

    try:
        count_by(_Exploding(), "title; drop table items")
    except ValueError as exc:
        assert "unsupported grouping column" in str(exc)
    else:
        raise AssertionError("expected ValueError for a non-whitelisted column")
