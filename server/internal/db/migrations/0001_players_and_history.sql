-- Wordle's own tables.
--
-- Better Auth owns "user", session, account, verification and jwks. Nothing
-- here alters those; players.user_id is the single crossing point between the
-- two halves of the system.

create table if not exists players (
    id           uuid primary key default gen_random_uuid(),
    -- References Better Auth's user table. Quoted because "user" is reserved.
    user_id      text not null unique references "user"(id) on delete cascade,
    display_name text not null,
    -- Which seat colour this player takes on a shared board.
    seat_color   text not null default 'rose',
    -- Short code a friend can type to find them. Unguessable ids are for
    -- security; this one is for reading aloud across a table.
    invite_code  text not null unique,
    created_at   timestamptz not null default now()
);

-- Every finished round. This is the history, the streak and the collection.
create table if not exists solves (
    id          uuid primary key default gen_random_uuid(),
    player_id   uuid not null references players(id) on delete cascade,
    word        text not null,
    pack_id     text not null,
    solved      boolean not null,
    -- Which row it fell on, or null if it never did.
    solved_row  integer,
    guesses     integer not null,
    hints_used  integer not null default 0,
    points      integer not null default 0,
    -- The local calendar day the round was played, which is what a streak
    -- counts. Stored separately from created_at because "did you play today"
    -- is a question about the player's day, not about UTC.
    played_on   date not null,
    created_at  timestamptz not null default now()
);

create index if not exists solves_player_played_on
    on solves (player_id, played_on desc);

-- A word is listed at most once per player even if the word comes round again.
create unique index if not exists solves_player_word
    on solves (player_id, word);

-- Words starred from the entry card, to come back to.
create table if not exists saved_words (
    player_id uuid not null references players(id) on delete cascade,
    word      text not null,
    saved_at  timestamptz not null default now(),
    primary key (player_id, word)
);

-- Friendships are stored once, not twice.
--
-- The pair is normalised so that low_id < high_id, which makes the unique
-- constraint do the work of preventing both duplicate requests and the case
-- where each person invites the other. requester_id says who asked.
create table if not exists friendships (
    id           uuid primary key default gen_random_uuid(),
    low_id       uuid not null references players(id) on delete cascade,
    high_id      uuid not null references players(id) on delete cascade,
    requester_id uuid not null references players(id) on delete cascade,
    status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'blocked')),
    created_at   timestamptz not null default now(),
    responded_at timestamptz,
    check (low_id < high_id),
    unique (low_id, high_id)
);

create index if not exists friendships_high on friendships (high_id);
