// Package testdb creates isolated schemas for integration tests. It never
// migrates or clears the public schema of the supplied database.
package testdb

import (
	"context"
	"crypto/rand"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jerkeyray/wordle/server/internal/db"
	"os"
	"testing"
)

const A = "00000000-0000-4000-8000-000000000001"
const B = "00000000-0000-4000-8000-000000000002"
const C = "00000000-0000-4000-8000-000000000003"
const Friendship = "10000000-0000-4000-8000-000000000001"

func ID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func Open(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL required for PostgreSQL integration tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	schema := "wordle_test_" + fmt.Sprintf("%x", []byte(ID())[:8]) + fmt.Sprintf("%x", []byte(ID())[24:])
	if _, err = admin.Exec(ctx, "create schema "+pgx.Identifier{schema}.Sanitize()); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "drop schema "+pgx.Identifier{schema}.Sanitize()+" cascade")
		admin.Close()
	})
	if _, err = pool.Exec(ctx, `create table "user" (id text primary key); insert into "user" values ('adi'),('ananya'),('outsider')`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `insert into players(id,user_id,display_name,invite_code) values($1,'adi','Adi','ADICDE'),($2,'ananya','Ananya','ANACDE'),($3,'outsider','Outsider','OUTCDE')`, A, B, C); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `insert into friendships(id,low_id,high_id,requester_id,status) values($1,$2,$3,$2,'accepted')`, Friendship, A, B); err != nil {
		t.Fatal(err)
	}
	return pool
}
