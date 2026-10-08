package players

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Friend is someone else, from one player's point of view.
type Friend struct {
	FriendshipID string
	PlayerID     string
	DisplayName  string
	Status       string
	PlayInvite   bool
	// Incoming is true when they asked you, rather than you asking them. It is
	// the only thing that decides whether the UI shows "pending" or "accept".
	Incoming bool
}

// pairOrder normalises a pair so the same two people always produce the same
// row, whichever of them asked. The unique index on (low_id, high_id) then
// prevents both duplicate requests and the case where each invites the other.
func pairOrder(a, b string) (low, high string) {
	if a < b {
		return a, b
	}
	return b, a
}

// RequestFriend links two players by invite code.
//
// If the other person has already invited you, this accepts rather than
// creating a second request. Combined Add & play requests are answered by
// the transactional invitation path, so friendship acceptance cannot skip
// dealing the shared board. Typing each other's legacy codes at the same time
// should produce a friendship, not a deadlock.
func (s *Store) RequestFriend(ctx context.Context, playerID, inviteCode string) (Friend, error) {
	code := strings.ToUpper(strings.TrimSpace(inviteCode))

	var other Player
	err := s.pool.QueryRow(ctx,
		`select id, display_name from players where invite_code = $1`, code,
	).Scan(&other.ID, &other.DisplayName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Friend{}, ErrNotFound
		}
		return Friend{}, fmt.Errorf("looking up invite code: %w", err)
	}

	if other.ID == playerID {
		return Friend{}, ErrSelfFriend
	}

	low, high := pairOrder(playerID, other.ID)

	var id, status, requester string
	err = s.pool.QueryRow(ctx, `
		insert into friendships (low_id, high_id, requester_id)
		values ($1, $2, $3)
		on conflict (low_id, high_id) do update set
			-- Their request plus yours means you both agreed.
			status       = case
			                 when friendships.status = 'pending'
			                  and friendships.requester_id <> $3 and not friendships.play_invite then 'accepted'
			                 else friendships.status
			               end,
			responded_at = case
			                 when friendships.status = 'pending'
			                  and friendships.requester_id <> $3 and not friendships.play_invite then now()
			                 else friendships.responded_at
			               end
		returning id, status, requester_id`,
		low, high, playerID,
	).Scan(&id, &status, &requester)
	if err != nil {
		return Friend{}, fmt.Errorf("creating friendship: %w", err)
	}

	return Friend{
		FriendshipID: id,
		PlayerID:     other.ID,
		DisplayName:  other.DisplayName,
		Status:       status,
		Incoming:     requester != playerID,
	}, nil
}

// RespondFriend accepts or declines a request addressed to this player.
//
// Only the person who did not send the request may answer it, which is what
// stops someone accepting on your behalf by guessing an id.
func (s *Store) RespondFriend(ctx context.Context, playerID, friendshipID string, accept bool) error {
	status := "blocked"
	if accept {
		status = "accepted"
	}

	tag, err := s.pool.Exec(ctx, `
		update friendships
		set status = $1, responded_at = now()
		where id = $2
		  and status = 'pending' and not play_invite
		  and requester_id <> $3
		  and $3 in (low_id, high_id)`,
		status, friendshipID, playerID)
	if err != nil {
		return fmt.Errorf("responding to friend request: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Friends lists everyone linked to this player, accepted or pending.
func (s *Store) Friends(ctx context.Context, playerID string) ([]Friend, error) {
	rows, err := s.pool.Query(ctx, `
		select f.id,
		       other.id,
		       other.display_name,
		       f.status,
		       f.requester_id <> $1 as incoming, f.play_invite
		from friendships f
		join players other
		  on other.id = case when f.low_id = $1 then f.high_id else f.low_id end
		where $1 in (f.low_id, f.high_id)
		  and f.status <> 'blocked'
		order by f.status, other.display_name`, playerID)
	if err != nil {
		return nil, fmt.Errorf("listing friends: %w", err)
	}
	defer rows.Close()

	var out []Friend
	for rows.Next() {
		var f Friend
		if err := rows.Scan(&f.FriendshipID, &f.PlayerID, &f.DisplayName,
			&f.Status, &f.Incoming, &f.PlayInvite); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
