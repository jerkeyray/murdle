alter table friendships add column play_invite boolean not null default false;
alter table friendships add column play_timezone text;
create table play_invite_requests (
    player_id uuid not null references players(id) on delete cascade,
    request_id uuid not null,
    fingerprint text not null,
    response jsonb not null,
    primary key (player_id, request_id)
);
