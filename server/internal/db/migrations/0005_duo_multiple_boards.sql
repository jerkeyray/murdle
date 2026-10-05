-- More than one shared board per day.
--
-- A board used to be identified by (duo_id, day), so a pair that finished
-- today's word had nothing left to play until tomorrow. Adding a sequence
-- number lets a day hold several boards: seq 0 is the day's first board, which
-- is every board that exists today, and "next word" adds seq 1, 2, and so on.
--
-- Additive: every existing row takes seq 0, so nothing is rewritten and an old
-- client that only knows about the day's first board keeps working.
--
-- The constraint names are the ones Postgres generated for 0002_daily_duos.
-- Guesses and passes reference the board, so their foreign keys come off first
-- and go back on once the board's key includes seq.
alter table duo_guesses drop constraint duo_guesses_duo_id_day_fkey;
alter table duo_passes  drop constraint duo_passes_duo_id_day_fkey;

alter table duo_days    add column seq integer not null default 0;
alter table duo_guesses add column seq integer not null default 0;
alter table duo_passes  add column seq integer not null default 0;

alter table duo_days    drop constraint duo_days_pkey;
alter table duo_guesses drop constraint duo_guesses_pkey;
alter table duo_passes  drop constraint duo_passes_pkey;

alter table duo_days    add primary key (duo_id, day, seq);
alter table duo_guesses add primary key (duo_id, day, seq, row_index);
alter table duo_passes  add primary key (duo_id, day, seq, player_id);

alter table duo_guesses add foreign key (duo_id, day, seq) references duo_days(duo_id, day, seq);
alter table duo_passes  add foreign key (duo_id, day, seq) references duo_days(duo_id, day, seq);
