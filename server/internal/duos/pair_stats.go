package duos

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type PairStats struct {
	Current     int `json:"current"`
	Longest     int `json:"longest"`
	WordsSolved int `json:"wordsSolved"`
}

// PairStats batches all requested friendships, preserving the same newest-duo
// ownership of each date as currentStreak. Extra losses never undo a day's win.
func (s *Store) PairStats(ctx context.Context, ids []string) (map[string]PairStats, error) {
	out := map[string]PairStats{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `with latest as (
 select distinct on(friendship_id) friendship_id,timezone from duos where friendship_id=any($1::uuid[]) order by friendship_id,created_at desc,id desc
 ), owners as (
 select distinct on(p.friendship_id,b.day) p.friendship_id,b.day,p.id from duos p join duo_days b on b.duo_id=p.id where p.friendship_id=any($1::uuid[]) order by p.friendship_id,b.day,p.created_at desc,p.id desc
 ), days as (
 select o.friendship_id,o.day,case when bool_or(b.state='won') then 'won' else (array_agg(b.state order by b.seq desc))[1] end as state
 from owners o join duo_days b on b.duo_id=o.id and b.day=o.day group by o.friendship_id,o.day
 ), wins as (
 select p.friendship_id,count(*) filter(where b.state='won') as n from duos p join duo_days b on b.duo_id=p.id where p.friendship_id=any($1::uuid[]) group by p.friendship_id
 ) select l.friendship_id::text,l.timezone,coalesce(d.day::text,''),coalesce(d.state,''),coalesce(w.n,0)
 from latest l left join days d on d.friendship_id=l.friendship_id left join wins w on w.friendship_id=l.friendship_id order by l.friendship_id,d.day desc`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	states := map[string]map[string]string{}
	dates := map[string]string{}
	for rows.Next() {
		var id, zone, date, state string
		var wins int
		if err = rows.Scan(&id, &zone, &date, &state, &wins); err != nil {
			return nil, err
		}
		today, _, e := dateAt(s.Now(), zone)
		if e != nil {
			return nil, e
		}
		dates[id] = today
		if states[id] == nil {
			states[id] = map[string]string{}
		}
		if date != "" && date <= today {
			states[id][date] = state
		}
		out[id] = PairStats{WordsSolved: wins}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	for id, days := range states {
		st := out[id]
		st.Current = streak(days, dates[id])
		st.Longest = longestPairStreak(days)
		out[id] = st
	}
	return out, nil
}
func longestPairStreak(states map[string]string) int {
	best := 0
	for date, state := range states {
		if state != "won" {
			continue
		}
		d, _ := time.Parse("2006-01-02", date)
		// Start only at the end of each contiguous run.
		if states[d.AddDate(0, 0, 1).Format("2006-01-02")] == "won" {
			continue
		}
		n := 0
		for states[d.Format("2006-01-02")] == "won" {
			n++
			d = d.AddDate(0, 0, -1)
		}
		if n > best {
			best = n
		}
	}
	return best
}

// ForFriendship is a detail read, so the overview never downloads histories.
func (s *Store) ForFriendship(ctx context.Context, friendship, player string) (*Duo, error) {
	var id string
	err := s.db.QueryRow(ctx, `select id::text from duos where friendship_id=$1 and $2 in(low_id,high_id) order by case when status in('active','pending') then 0 else 1 end,created_at desc,id desc limit 1`, friendship, player).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id, player)
}
