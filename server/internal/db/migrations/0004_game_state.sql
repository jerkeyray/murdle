-- Solo runs and rounds, which until now lived in one process's memory.
--
-- That only ever worked because one process served every request. On a
-- platform that runs several instances a run created on one container is
-- absent from the next, so the very next call — dealing the first word —
-- failed with "no such run". The board could not load a word at all.
--
-- Stored as a blob keyed by id: the shape of a round belongs to the game
-- package and changes with the rules, and nothing queries inside it. The only
-- predicates are the primary key and the sweep's timestamp, which is indexed.
create table if not exists game_runs (
    id         text primary key,
    data       jsonb not null,
    updated_at timestamptz not null default now()
);

create table if not exists game_rounds (
    id         text primary key,
    data       jsonb not null,
    updated_at timestamptz not null default now()
);

create index if not exists game_runs_updated_at on game_runs (updated_at);
create index if not exists game_rounds_updated_at on game_rounds (updated_at);
