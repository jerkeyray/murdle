-- Idempotency receipts for solo run creation and next-round mutations. The
-- snapshot is the exact response committed with each mutation. Cleanup follows
-- the same 30-day retention window as solo game state.
create table if not exists solo_request_receipts (
    request_id text primary key,
    operation text not null,
    fingerprint text not null,
    run_id text not null,
    run_data jsonb not null,
    round_data jsonb not null,
    created_at timestamptz not null default now()
);

create index if not exists solo_request_receipts_created_at on solo_request_receipts (created_at);
create index if not exists solo_request_receipts_run_id on solo_request_receipts (run_id);
