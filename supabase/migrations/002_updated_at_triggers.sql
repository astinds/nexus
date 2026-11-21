-- NEXUS v1.0 -- 002 updated_at maintenance
-- Keeps items.updated_at (and the small catalog tables that expose it) honest
-- without trusting every code path to remember it. Idempotent.

begin;

create or replace function nexus_touch_updated_at() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

do $$
declare
    target text;
begin
    foreach target in array array['items', 'collections', 'workspaces', 'metadata_blueprints'] loop
        -- collections/workspaces/blueprints have no updated_at column in v1.0;
        -- only attach the trigger where the column exists.
        if exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = target and column_name = 'updated_at'
        ) then
            execute format('drop trigger if exists %I on %I', target || '_touch_updated_at', target);
            execute format(
                'create trigger %I before update on %I for each row execute function nexus_touch_updated_at()',
                target || '_touch_updated_at', target
            );
        end if;
    end loop;
end;
$$;

commit;
