-- row_index was pinned to 0..5, which hardcoded six guesses into the schema and
-- would have turned raising game.MaxRows into a constraint violation mid-game.
-- The floor is the only part the database needs to enforce; the ceiling belongs
-- to game.MaxRows, which the duos store now reads.
alter table duo_guesses drop constraint duo_guesses_row_index_check;
alter table duo_guesses add constraint duo_guesses_row_index_check check (row_index >= 0);

-- Receipts exist to make a retried mutation idempotent for the few seconds a
-- phone might spend reconnecting, but nothing ever deleted them, so the table
-- grew a full serialized response per mutation forever. Dating them lets the
-- store sweep its own old rows.
alter table duo_requests add column created_at timestamptz not null default now();
create index duo_requests_created_at on duo_requests(created_at);
