-- Presence is ephemeral but shared by all API instances. One bounded row per player.
create table player_presence (
 player_id uuid primary key references players(id) on delete cascade,
 last_seen timestamptz not null
);
create index player_presence_last_seen on player_presence(last_seen);
-- Supports friendship-scoped history and selecting the latest partnership.
create index duos_friendship_created on duos(friendship_id, created_at desc, id desc);
create index duo_days_playing_deadline on duo_days(duo_id, deadline) where state='playing';
create index duo_requests_player_created on duo_requests(player_id, created_at);
