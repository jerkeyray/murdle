create table duos (
    id uuid primary key default gen_random_uuid(),
    friendship_id uuid not null references friendships(id),
    inviter_id uuid not null references players(id),
    low_id uuid not null references players(id),
    high_id uuid not null references players(id),
    timezone text not null,
    status text not null check (status in ('pending','active','declined','cancelled','ended')),
    version integer not null default 0,
    started_on date,
    created_at timestamptz not null default now(),
    ended_at timestamptz,
    check (low_id < high_id),
    check (inviter_id in (low_id, high_id))
);
create unique index duos_open_friendship on duos(friendship_id) where status in ('pending','active');
create table duo_days (
    duo_id uuid not null references duos(id),
    day date not null,
    deadline timestamptz not null,
    answer text not null,
    entry jsonb not null,
    cycle integer not null,
    state text not null check (state in ('playing','won','lost','expired','closed')),
    current_player uuid not null references players(id),
    version integer not null default 0,
    primary key (duo_id, day)
);
create table duo_guesses (
    duo_id uuid not null,
    day date not null,
    row_index integer not null check (row_index between 0 and 5),
    player_id uuid not null references players(id),
    guess text not null,
    marks jsonb not null,
    created_at timestamptz not null default now(),
    primary key (duo_id, day, row_index),
    foreign key (duo_id, day) references duo_days(duo_id, day)
);
create table duo_passes (
    duo_id uuid not null,
    day date not null,
    player_id uuid not null references players(id),
    created_at timestamptz not null default now(),
    primary key (duo_id, day, player_id),
    foreign key (duo_id, day) references duo_days(duo_id, day)
);
create table duo_requests (
    player_id uuid not null references players(id),
    request_id uuid not null,
    fingerprint text not null,
    response jsonb not null,
    primary key (player_id, request_id)
);
