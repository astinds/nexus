"""Repository primitives.

Every repository receives an open psycopg cursor and returns plain dictionaries,
so services and API layers never build SQL and repositories never raise HTTP
errors. Values are always bound as parameters; only identifiers written in this
codebase (column names, whitelisted sort orders) are interpolated.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Mapping, Sequence

import psycopg
from psycopg.types.json import Jsonb

Params = Mapping[str, Any]

# Column identifiers reach SQL by string interpolation, so they are validated
# here. Values never do: those are always bound as parameters below.
COLUMN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")


def as_parameter(value: Any) -> Any:
    """Adapt a plain dict for a json/jsonb column.

    psycopg 3 ships no default adapter for `dict`: binding one raises
    `ProgrammingError: cannot adapt type 'dict' using placeholder '%s'`. Every
    dict this codebase binds belongs to a jsonb column (`custom_fields`,
    `metadata`, `config`, `payload`), so wrap it here instead of relying on each
    caller to remember `Jsonb`.

    Lists are deliberately left alone: a list is a valid `text[]`/`uuid[]`
    binding (`tags.aliases`), and wrapping it in `Jsonb` would break those.
    """
    return Jsonb(value) if isinstance(value, dict) else value


def validate_column(column: str) -> str:
    """Accept `name` or `table.name`; refuse anything that could carry SQL."""
    if not isinstance(column, str) or not COLUMN_RE.match(column):
        raise ValueError(f"unsafe SQL column identifier: {column!r}")
    return column


class Query:
    """Accumulates a WHERE clause with named parameters.

    Column names must come from a fixed whitelist in the calling repository.
    """

    def __init__(self) -> None:
        self.clauses: list[str] = []
        self.params: dict[str, Any] = {}

    def _bind(self, value: Any) -> str:
        name = f"p{len(self.params)}"
        self.params[name] = value
        return f"%({name})s"

    def eq(self, column: str, value: Any, *, cast: str | None = None) -> "Query":
        if value is None:
            return self
        validate_column(column)
        self.clauses.append(f"{column} = {self._bind(value)}{f'::{cast}' if cast else ''}")
        return self

    def neq(self, column: str, value: Any) -> "Query":
        if value is None:
            return self
        validate_column(column)
        self.clauses.append(f"{column} <> {self._bind(value)}")
        return self

    def any_of(self, column: str, values: Sequence[Any] | None) -> "Query":
        if not values:
            return self
        validate_column(column)
        self.clauses.append(f"{column} = any({self._bind(list(values))})")
        return self

    def ilike(self, column: str, value: str | None, *, contains: bool = True) -> "Query":
        if not value:
            return self
        validate_column(column)
        pattern = f"%{value}%" if contains else f"{value}%"
        self.clauses.append(f"{column} ilike {self._bind(pattern)}")
        return self

    def raw(self, clause: str, **params: Any) -> "Query":
        """Add a hand-written clause with its own named parameters.

        Deliberate escape hatch for SQL that needs subqueries. Column identifiers
        inside `clause` are the caller's responsibility: never pass user input here.
        """
        for key, value in params.items():
            if key in self.params:
                raise ValueError(f"duplicate query parameter {key}")
            self.params[key] = value
        self.clauses.append(clause)
        return self

    def where(self, prefix: str = " where ") -> str:
        return prefix + " and ".join(self.clauses) if self.clauses else ""

    @property
    def is_empty(self) -> bool:
        return not self.clauses


def fetch_all(cur: psycopg.Cursor, sql: str, params: Params | None = None) -> list[dict]:
    cur.execute(sql, params or {})
    return list(cur.fetchall())


def fetch_one(cur: psycopg.Cursor, sql: str, params: Params | None = None) -> dict | None:
    cur.execute(sql, params or {})
    return cur.fetchone()


def fetch_scalar(cur: psycopg.Cursor, sql: str, params: Params | None = None, default: Any = 0) -> Any:
    row = fetch_one(cur, sql, params)
    if not row:
        return default
    value = next(iter(row.values()))
    return default if value is None else value


def execute(cur: psycopg.Cursor, sql: str, params: Params | None = None) -> int:
    cur.execute(sql, params or {})
    return cur.rowcount


def insert_returning(
    cur: psycopg.Cursor,
    table: str,
    values: Mapping[str, Any],
    *,
    returning: str = "*",
) -> dict:
    if not values:
        raise ValueError("insert requires at least one column")
    columns = list(values.keys())
    params = {f"v{index}": as_parameter(values[column]) for index, column in enumerate(columns)}
    placeholders = ", ".join(f"%({name})s" for name in params)
    sql = (
        f"insert into {table} ({', '.join(columns)}) values ({placeholders}) "
        f"returning {returning}"
    )
    row = fetch_one(cur, sql, params)
    assert row is not None  # a successful INSERT ... RETURNING always yields a row
    return row


def update_returning(
    cur: psycopg.Cursor,
    table: str,
    *,
    ident: Mapping[str, Any],
    values: Mapping[str, Any],
    returning: str = "*",
) -> dict | None:
    """Update one row identified by `ident`. Returns None when nothing matched."""
    if not values:
        return None
    params: dict[str, Any] = {}
    assignments = []
    for index, (column, value) in enumerate(values.items()):
        name = f"s{index}"
        params[name] = as_parameter(value)
        assignments.append(f"{column} = %({name})s")
    predicates = []
    for index, (column, value) in enumerate(ident.items()):
        name = f"w{index}"
        params[name] = value
        predicates.append(f"{column} = %({name})s")
    sql = (
        f"update {table} set {', '.join(assignments)} "
        f"where {' and '.join(predicates)} returning {returning}"
    )
    return fetch_one(cur, sql, params)


def delete_where(cur: psycopg.Cursor, table: str, **ident: Any) -> bool:
    if not ident:
        raise ValueError("refusing to delete without a predicate")
    params = {f"w{index}": value for index, value in enumerate(ident.values())}
    predicates = " and ".join(f"{column} = %({name})s" for column, name in zip(ident, params))
    return execute(cur, f"delete from {table} where {predicates}", params) > 0


def count_rows(cur: psycopg.Cursor, table: str, query: Query, *, alias: str = "n") -> int:
    return int(fetch_scalar(cur, f"select count(*) as {alias} from {table}{query.where()}", query.params))


def group_counts(
    cur: psycopg.Cursor,
    sql: str,
    params: Params | None = None,
) -> dict[str, int]:
    """Run a `select key, count(*)` style query into a plain dict."""
    rows = fetch_all(cur, sql, params)
    result: dict[str, int] = {}
    for row in rows:
        values: Iterable[Any] = row.values()
        key, value = list(values)[:2]
        result[str(key)] = int(value)
    return result


SORT_ORDERS: dict[str, str] = {
    "recent": "i.updated_at desc",
    "created": "i.created_at desc",
    "title": "lower(i.title) asc",
    "reading_time": "i.est_read_minutes asc nulls last, i.created_at desc",
    "word_count": "i.word_count desc",
}


def order_by(sort: str | None, *, table_alias: str = "i") -> str:
    """Whitelisted ORDER BY. Unknown values fall back to 'recent'."""
    clause = SORT_ORDERS.get((sort or "recent").lower(), SORT_ORDERS["recent"])
    if table_alias == "i":
        return clause
    return clause.replace("i.", f"{table_alias}.")
