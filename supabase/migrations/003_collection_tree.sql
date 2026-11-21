-- NEXUS v1.0 -- 003 collection tree helper
-- The Library's collection filter must include nested children. A recursive CTE
-- is correct but awkward to inline inside a parameterised query, so it lives in
-- one stable SQL function instead. Idempotent.

begin;

create or replace function nexus_collection_tree(root uuid)
returns table (id uuid) as $$
    with recursive tree as (
        select c.id from collections c where c.id = root
        union all
        select child.id
        from collections child
        join tree parent on child.parent_id = parent.id
    )
    select t.id from tree t;
$$ language sql stable;

commit;
