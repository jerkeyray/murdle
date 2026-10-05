-- Keep streak activity separate from the unique vocabulary collection.
-- Historical duplicate dates already overwritten by the old upsert cannot be
-- recovered; this seeds all distinct dates still present in solves.
create table if not exists player_activity_days (
    player_id uuid not null references players(id) on delete cascade,
    played_on date not null,
    primary key (player_id, played_on)
);

insert into player_activity_days (player_id, played_on)
select distinct player_id, played_on from solves
on conflict do nothing;
