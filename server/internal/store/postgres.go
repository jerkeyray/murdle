package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jerkeyray/wordle/server/internal/game"
)

// Postgres keeps runs and rounds in the database.
//
// The memory store works only while one process serves every request. Behind a
// platform that runs several instances there is no such guarantee: a run
// created on one container is simply absent from the next, so dealing the
// first word of a freshly created run fails with "no such run". That is not a
// tuning problem, so this is what production runs on.
type Postgres struct {
	pool *pgxpool.Pool
	ttl  time.Duration
}

// NewPostgres returns a store that drops records untouched for ttl.
//
// The ttl exists to clear abandoned runs, not to take finished work away from
// anybody, so it is measured in weeks rather than hours.
func NewPostgres(pool *pgxpool.Pool, ttl time.Duration) *Postgres {
	return &Postgres{pool: pool, ttl: ttl}
}

// roundRecord is the stored shape of a round.
//
// It exists because game.Round keeps its answer unexported, which is
// deliberate — it is what stops the answer being marshalled to a player by
// accident. Writing the mapping out here means persistence can see the answer
// without the game package ever offering it to anything else.
type roundRecord struct {
	ID                  string            `json:"id"`
	RunID               string            `json:"runId"`
	Mode                string            `json:"mode,omitempty"`
	Answer              string            `json:"answer"`
	WordLength          int               `json:"wordLength,omitempty"`
	Rows                []game.Row        `json:"rows"`
	HintsUsed           int               `json:"hintsUsed"`
	SolvedRow           int               `json:"solvedRow"`
	State               game.State        `json:"state"`
	Hints               []game.HintReveal `json:"hints"`
	RequestIDs          map[string]bool   `json:"requestIds,omitempty"`
	RequestFingerprints map[string]string `json:"requestFingerprints,omitempty"`
	CreatedAt           time.Time         `json:"createdAt"`
	UpdatedAt           time.Time         `json:"updatedAt"`
}

type runRecord struct {
	ID         string        `json:"id"`
	PackID     string        `json:"packId"`
	Mode       string        `json:"mode,omitempty"`
	WordLength int           `json:"wordLength,omitempty"`
	Words      []string      `json:"words"`
	RoundIDs   []string      `json:"roundIds"`
	Points     int           `json:"points"`
	Results    []roundRecord `json:"results"`
	NewCycle   bool          `json:"newCycle"`
	Finished   int           `json:"finished"`
	CreatedAt  time.Time     `json:"createdAt"`
	UpdatedAt  time.Time     `json:"updatedAt"`
}

func newRoundRecord(r *game.Round) roundRecord {
	return roundRecord{
		ID: r.ID, RunID: r.RunID, Mode: r.Mode, Answer: r.Answer(), WordLength: r.WordLength, Rows: r.Rows,
		HintsUsed: r.HintsUsed, SolvedRow: r.SolvedRow, State: r.State,
		Hints: r.Hints, RequestIDs: r.RequestIDs, RequestFingerprints: r.RequestFingerprints, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func (rec roundRecord) round() *game.Round {
	r := game.NewRound(rec.ID, rec.Answer)
	r.Mode = rec.Mode
	if rec.WordLength > 0 {
		r.WordLength = rec.WordLength
	}
	r.RunID = rec.RunID
	r.HintsUsed = rec.HintsUsed
	r.SolvedRow = rec.SolvedRow
	r.State = rec.State
	r.CreatedAt = rec.CreatedAt
	r.UpdatedAt = rec.UpdatedAt
	if rec.Rows != nil {
		r.Rows = rec.Rows
	}
	if rec.Hints != nil {
		r.Hints = rec.Hints
	}
	if rec.RequestIDs != nil {
		r.RequestIDs = rec.RequestIDs
	}
	if rec.RequestFingerprints != nil {
		r.RequestFingerprints = rec.RequestFingerprints
	}
	return r
}

func newRunRecord(r *game.Run) runRecord {
	results := make([]roundRecord, len(r.Results))
	for i := range r.Results {
		results[i] = newRoundRecord(&r.Results[i])
	}
	return runRecord{
		ID: r.ID, PackID: r.PackID, Mode: r.Mode, WordLength: r.WordLength, Words: r.Words, RoundIDs: r.RoundIDs,
		Points: r.Points, Results: results, NewCycle: r.NewCycle,
		Finished: r.Finished, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func (rec runRecord) run() *game.Run {
	r := &game.Run{
		ID: rec.ID, PackID: rec.PackID, Mode: rec.Mode, WordLength: rec.WordLength, Words: rec.Words, RoundIDs: rec.RoundIDs,
		Points: rec.Points, NewCycle: rec.NewCycle, Finished: rec.Finished,
		CreatedAt: rec.CreatedAt, UpdatedAt: rec.UpdatedAt,
	}
	if r.RoundIDs == nil {
		r.RoundIDs = []string{}
	}
	if r.Mode == "" {
		r.Mode = "themed"
	}
	if r.WordLength == 0 && len(r.Words) > 0 {
		r.WordLength = len([]rune(r.Words[0]))
	}
	r.Results = make([]game.Round, len(rec.Results))
	for i := range rec.Results {
		r.Results[i] = *rec.Results[i].round()
	}
	return r
}

// The row is a blob keyed by id because nothing queries inside it. The shape of
// a round belongs to the game package and changes with the rules; a column per
// field would turn every rule change into a migration for no gain, since the
// only predicates here are the primary key and the sweep's timestamp.
func (p *Postgres) put(ctx context.Context, table, id string, rec any) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("encoding %s: %w", table, err)
	}
	_, err = p.pool.Exec(ctx, `
		insert into `+table+` (id, data, updated_at) values ($1, $2, now())
		on conflict (id) do update set data = excluded.data, updated_at = now()`, id, data)
	if err != nil {
		return fmt.Errorf("storing %s: %w", table, err)
	}
	return nil
}

// fetch reads one record, treating anything past the ttl as gone.
func (p *Postgres) fetch(ctx context.Context, q pgx.Tx, table, id string, lock bool, into any) error {
	sql := `select data from ` + table + ` where id = $1 and updated_at > $2`
	if lock {
		sql += ` for update`
	}
	var data []byte
	var err error
	if q != nil {
		err = q.QueryRow(ctx, sql, id, p.cutoff()).Scan(&data)
	} else {
		err = p.pool.QueryRow(ctx, sql, id, p.cutoff()).Scan(&data)
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, into)
}

func (p *Postgres) cutoff() time.Time {
	if p.ttl <= 0 {
		return time.Time{}
	}
	return time.Now().Add(-p.ttl)
}

func (p *Postgres) Create(ctx context.Context, r *game.Round) error {
	return p.put(ctx, "game_rounds", r.ID, newRoundRecord(r))
}

func (p *Postgres) Get(ctx context.Context, id string) (*game.Round, error) {
	var rec roundRecord
	if err := p.fetch(ctx, nil, "game_rounds", id, false, &rec); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, game.ErrRoundNotFound
		}
		return nil, err
	}
	return rec.round(), nil
}

// Update takes a row lock for the whole read-modify-write, which is what stops
// two fast taps both claiming the same row of the board.
func (p *Postgres) Update(ctx context.Context, id string, fn func(*game.Round) error) (*game.Round, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var rec roundRecord
	if err = p.fetch(ctx, tx, "game_rounds", id, true, &rec); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, game.ErrRoundNotFound
		}
		return nil, err
	}

	round := rec.round()
	if err = fn(round); err != nil {
		return nil, err
	}

	data, err := json.Marshal(newRoundRecord(round))
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx,
		`update game_rounds set data = $2, updated_at = now() where id = $1`, id, data); err != nil {
		return nil, err
	}
	return round, tx.Commit(ctx)
}

func (p *Postgres) CreateRun(ctx context.Context, r *game.Run) error {
	return p.put(ctx, "game_runs", r.ID, newRunRecord(r))
}

// CreateRunWithFirstRound commits a new run and its first board together.
func (p *Postgres) CreateRunWithFirstRound(ctx context.Context, run *game.Run, roundID string) (*game.Run, *game.Round, error) {
	return p.CreateRunWithFirstRoundRequest(ctx, run, roundID, "", "")
}

// CreateRunWithFirstRoundRequest commits the run, its first board, and an
// idempotency receipt as one unit.
func (p *Postgres) CreateRunWithFirstRoundRequest(ctx context.Context, run *game.Run, roundID, requestID, fingerprint string) (*game.Run, *game.Round, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	if requestID != "" {
		if err := lockSoloRequest(ctx, tx, requestID); err != nil {
			return nil, nil, err
		}
		if oldRun, oldRound, err := loadSoloReceipt(ctx, tx, requestID, "create_run", fingerprint); err != nil || oldRun != nil {
			if err != nil {
				return nil, nil, err
			}
			if err := tx.Commit(ctx); err != nil {
				return nil, nil, err
			}
			return oldRun, oldRound, nil
		}
	}
	staged := cloneRun(run)
	answer, err := staged.StartRound(roundID)
	if err != nil {
		return nil, nil, err
	}
	round := game.NewRound(roundID, answer)
	round.RunID, round.Mode = staged.ID, staged.Mode
	data, err := json.Marshal(newRunRecord(staged))
	if err != nil {
		return nil, nil, err
	}
	if _, err = tx.Exec(ctx, `insert into game_runs(id,data,updated_at) values($1,$2,now())`, staged.ID, data); err != nil {
		return nil, nil, err
	}
	roundData, err := json.Marshal(newRoundRecord(round))
	if err != nil {
		return nil, nil, err
	}
	if _, err = tx.Exec(ctx, `insert into game_rounds(id,data,updated_at) values($1,$2,now())`, round.ID, roundData); err != nil {
		return nil, nil, err
	}
	if requestID != "" {
		if err = saveSoloReceipt(ctx, tx, requestID, "create_run", fingerprint, staged.ID, data, roundData); err != nil {
			return nil, nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return staged, round, nil
}

// StartRunRound advances a run and creates its board in one transaction.
func (p *Postgres) StartRunRound(ctx context.Context, runID, roundID string) (*game.Run, *game.Round, error) {
	return p.startRunRound(ctx, runID, roundID, "", "", "", false)
}

// StartRunRoundRequest validates the caller's expected current board and
// commits an idempotent next-board receipt with the run and board update.
func (p *Postgres) StartRunRoundRequest(ctx context.Context, runID, roundID, expectedRoundID, requestID, fingerprint string) (*game.Run, *game.Round, error) {
	return p.startRunRound(ctx, runID, roundID, expectedRoundID, requestID, fingerprint, true)
}

func (p *Postgres) startRunRound(ctx context.Context, runID, roundID, expectedRoundID, requestID, fingerprint string, enforceExpected bool) (*game.Run, *game.Round, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	if requestID != "" {
		if err := lockSoloRequest(ctx, tx, requestID); err != nil {
			return nil, nil, err
		}
		if oldRun, oldRound, err := loadSoloReceipt(ctx, tx, requestID, "next_round", fingerprint); err != nil || oldRun != nil {
			if err != nil {
				return nil, nil, err
			}
			if err := tx.Commit(ctx); err != nil {
				return nil, nil, err
			}
			return oldRun, oldRound, nil
		}
	}
	var rec runRecord
	if err = p.fetch(ctx, tx, "game_runs", runID, true, &rec); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, game.ErrRunNotFound
		}
		return nil, nil, err
	}
	run := rec.run()
	currentRoundID := ""
	if len(run.RoundIDs) > 0 {
		currentRoundID = run.RoundIDs[len(run.RoundIDs)-1]
	}
	if enforceExpected && expectedRoundID != currentRoundID {
		return nil, nil, game.ErrStaleRun
	}
	answer, err := run.StartRound(roundID)
	if err != nil {
		return nil, nil, err
	}
	round := game.NewRound(roundID, answer)
	round.RunID, round.Mode = runID, run.Mode
	runData, err := json.Marshal(newRunRecord(run))
	if err != nil {
		return nil, nil, err
	}
	roundData, err := json.Marshal(newRoundRecord(round))
	if err != nil {
		return nil, nil, err
	}
	if _, err = tx.Exec(ctx, `update game_runs set data=$2,updated_at=now() where id=$1`, runID, runData); err != nil {
		return nil, nil, err
	}
	if _, err = tx.Exec(ctx, `insert into game_rounds(id,data,updated_at) values($1,$2,now())`, roundID, roundData); err != nil {
		return nil, nil, err
	}
	if requestID != "" {
		if err = saveSoloReceipt(ctx, tx, requestID, "next_round", fingerprint, run.ID, runData, roundData); err != nil {
			return nil, nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return run, round, nil
}

// UpdateRoundAndRun commits a guess and its completed run snapshot atomically.
func (p *Postgres) UpdateRoundAndRun(ctx context.Context, roundID string, fn func(*game.Round, *game.Run, pgx.Tx) error) (*game.Round, *game.Run, error) {
	var initial roundRecord
	if err := p.fetch(ctx, nil, "game_rounds", roundID, false, &initial); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, game.ErrRoundNotFound
		}
		return nil, nil, err
	}
	if initial.RunID == "" {
		return nil, nil, game.ErrRunNotFound
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	var rr runRecord
	if err = p.fetch(ctx, tx, "game_runs", initial.RunID, true, &rr); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, game.ErrRunNotFound
		}
		return nil, nil, err
	}
	var br roundRecord
	if err = p.fetch(ctx, tx, "game_rounds", roundID, true, &br); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, game.ErrRoundNotFound
		}
		return nil, nil, err
	}
	round, run := br.round(), rr.run()
	if err = fn(round, run, tx); err != nil {
		return nil, nil, err
	}
	if round.State != game.StatePlaying {
		run.RecordRound(round)
	}
	runData, err := json.Marshal(newRunRecord(run))
	if err != nil {
		return nil, nil, err
	}
	roundData, err := json.Marshal(newRoundRecord(round))
	if err != nil {
		return nil, nil, err
	}
	if _, err = tx.Exec(ctx, `update game_rounds set data=$2,updated_at=now() where id=$1`, roundID, roundData); err != nil {
		return nil, nil, err
	}
	if _, err = tx.Exec(ctx, `update game_runs set data=$2,updated_at=now() where id=$1`, run.ID, runData); err != nil {
		return nil, nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return round, run, nil
}

func (p *Postgres) GetRun(ctx context.Context, id string) (*game.Run, error) {
	var rec runRecord
	if err := p.fetch(ctx, nil, "game_runs", id, false, &rec); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, game.ErrRunNotFound
		}
		return nil, err
	}
	return rec.run(), nil
}

func (p *Postgres) UpdateRun(ctx context.Context, id string, fn func(*game.Run) error) (*game.Run, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var rec runRecord
	if err = p.fetch(ctx, tx, "game_runs", id, true, &rec); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, game.ErrRunNotFound
		}
		return nil, err
	}

	run := rec.run()
	if err = fn(run); err != nil {
		return nil, err
	}

	data, err := json.Marshal(newRunRecord(run))
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx,
		`update game_runs set data = $2, updated_at = now() where id = $1`, id, data); err != nil {
		return nil, err
	}
	return run, tx.Commit(ctx)
}

func lockSoloRequest(ctx context.Context, tx pgx.Tx, requestID string) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, "solo:"+requestID)
	return err
}

func loadSoloReceipt(ctx context.Context, tx pgx.Tx, requestID, operation, fingerprint string) (*game.Run, *game.Round, error) {
	var oldOperation, oldFingerprint string
	var runData, roundData []byte
	err := tx.QueryRow(ctx, `select operation, fingerprint, run_data, round_data from solo_request_receipts where request_id=$1`, requestID).Scan(&oldOperation, &oldFingerprint, &runData, &roundData)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if oldOperation != operation || oldFingerprint != fingerprint {
		return nil, nil, game.ErrRequestReused
	}
	var rr runRecord
	var br roundRecord
	if err := json.Unmarshal(runData, &rr); err != nil {
		return nil, nil, err
	}
	if err := json.Unmarshal(roundData, &br); err != nil {
		return nil, nil, err
	}
	return rr.run(), br.round(), nil
}

func saveSoloReceipt(ctx context.Context, tx pgx.Tx, requestID, operation, fingerprint, runID string, runData, roundData []byte) error {
	_, err := tx.Exec(ctx, `insert into solo_request_receipts(request_id,operation,fingerprint,run_id,run_data,round_data) values($1,$2,$3,$4,$5,$6)`, requestID, operation, fingerprint, runID, runData, roundData)
	return err
}

// Reap deletes records past the ttl until ctx is cancelled.
func (p *Postgres) Reap(ctx context.Context, every time.Duration, onError func(error)) {
	if p.ttl <= 0 {
		return
	}
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cutoff := p.cutoff()
			for _, table := range []string{"game_rounds", "game_runs"} {
				if _, err := p.pool.Exec(ctx,
					`delete from `+table+` where updated_at <= $1`, cutoff); err != nil && ctx.Err() == nil {
					if onError != nil {
						onError(fmt.Errorf("reaping %s: %w", table, err))
					}
				}
			}
			if _, err := p.pool.Exec(ctx, `delete from solo_request_receipts r where not exists (select 1 from game_runs g where g.id=r.run_id)`); err != nil && ctx.Err() == nil && onError != nil {
				onError(fmt.Errorf("reaping solo_request_receipts: %w", err))
			}
		}
	}
}
