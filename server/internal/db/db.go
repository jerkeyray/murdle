// Package db owns the Postgres connection and the schema Wordle manages.
//
// Better Auth manages its own tables from the Next.js side; the migrations
// here never touch them.
package db

import (
	"context"
	"embed"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Open connects and verifies the connection before returning it.
//
// Failing here at startup is deliberate: a server that boots without a
// database only fails later, in front of a player, with a worse error.
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parsing database url: %w", err)
	}

	// Neon's pooler sits in front of this, so the local pool stays small.
	cfg.MaxConns = 8
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connecting: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging: %w", err)
	}

	return pool, nil
}

// Migrate applies any migration files this database has not seen.
//
// Small enough to not want a migration library: the files are embedded, they
// run in filename order, and each one runs inside a transaction alongside the
// insert that records it — so a failed migration leaves no trace and can be
// fixed and rerun.
func Migrate(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	_, err := pool.Exec(ctx, `
		create table if not exists schema_migrations (
			name       text primary key,
			applied_at timestamptz not null default now()
		)`)
	if err != nil {
		return nil, fmt.Errorf("creating schema_migrations: %w", err)
	}

	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)

	var applied []string
	for _, name := range names {
		var exists bool
		err := pool.QueryRow(ctx,
			`select exists (select 1 from schema_migrations where name = $1)`, name,
		).Scan(&exists)
		if err != nil {
			return nil, fmt.Errorf("checking %s: %w", name, err)
		}
		if exists {
			continue
		}

		sql, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			return nil, err
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			_ = tx.Rollback(ctx)
			return nil, fmt.Errorf("applying %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx,
			`insert into schema_migrations (name) values ($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return nil, fmt.Errorf("recording %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("committing %s: %w", name, err)
		}

		applied = append(applied, name)
	}

	return applied, nil
}
