package players

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type FriendProfile struct {
	PlayerID    string    `json:"-"`
	ID          string    `json:"id"`
	DisplayName string    `json:"displayName"`
	JoinedAt    time.Time `json:"joinedAt"`
	WordsSolved int       `json:"wordsSolved"`
	Streak      struct {
		Current int `json:"current"`
		Longest int `json:"longest"`
	} `json:"streak"`
}

func (s *Store) FriendProfile(ctx context.Context, viewer, friendship string, today time.Time) (*FriendProfile, error) {
	p := &FriendProfile{ID: friendship}
	var player string
	err := s.pool.QueryRow(ctx, `select other.id::text,other.display_name,other.created_at
 from friendships f join players other on other.id=case when f.low_id=$2 then f.high_id else f.low_id end
 where f.id=$1 and $2 in(f.low_id,f.high_id) and f.status='accepted'`, friendship, viewer).Scan(&player, &p.DisplayName, &p.JoinedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	// UNION removes repeats within and between solo and all shared games.
	err = s.pool.QueryRow(ctx, `select count(*) from (
 select word from solves where player_id=$1 and solved
 union select b.answer from duo_days b join duos d on d.id=b.duo_id where $1 in(d.low_id,d.high_id) and b.state='won'
 ) words`, player).Scan(&p.WordsSolved)
	if err != nil {
		return nil, err
	}
	p.PlayerID = player
	st, err := s.Streak(ctx, player, today)
	if err != nil {
		return nil, err
	}
	p.Streak.Current, p.Streak.Longest = st.Current, st.Longest
	return p, nil
}
