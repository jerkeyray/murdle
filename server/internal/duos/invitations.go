package duos

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type PlayInvitation struct {
	FriendshipID string `json:"friendshipId"`
	Status       string `json:"status"`
	Duo          *Duo   `json:"duo,omitempty"`
}
type PlayInviteMutation struct {
	RequestID  string `json:"requestId"`
	InviteCode string `json:"inviteCode,omitempty"`
	Timezone   string `json:"timezone,omitempty"`
}

// PlayInvite holds the friendship lock through acceptance and dealing. A pending
// combined invitation has no duo yet, so it cannot appear twice in the inbox.
func (s *Store) PlayInvite(ctx context.Context, player, friendship, action string, m PlayInviteMutation) (*PlayInvitation, error) {
	if !uuid(m.RequestID) {
		return nil, fail("invalid_body", "A request ID is required")
	}
	if action != "create" && action != "accept" && action != "decline" && action != "cancel" {
		return nil, fail("invalid_action", "Invitation action not found")
	}
	if action == "create" {
		if _, err := time.LoadLocation(m.Timezone); err != nil || m.Timezone == "" || m.Timezone == "Local" {
			return nil, fail("invalid_timezone", "Choose a valid timezone")
		}
	} else if !uuid(friendship) {
		return nil, fail("not_found", "Invitation not found")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// This receipt namespace is independent of the existing duo receipts.
	if _, err = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, "play:"+player+":"+m.RequestID); err != nil {
		return nil, err
	}
	body, _ := json.Marshal(m)
	sum := sha256.Sum256(append([]byte(friendship+":"+action+":"), body...))
	fingerprint := hex.EncodeToString(sum[:])
	var oldHash string
	var old []byte
	err = tx.QueryRow(ctx, `select fingerprint,response from play_invite_requests where player_id=$1 and request_id=$2`, player, m.RequestID).Scan(&oldHash, &old)
	if err == nil {
		if oldHash != fingerprint {
			return nil, fail("request_reused", "This request ID was already used")
		}
		var result PlayInvitation
		if err = json.Unmarshal(old, &result); err != nil {
			return nil, err
		}
		return &result, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var low, high, requester, status, zone string
	var combined bool
	if action == "create" {
		var other string
		err = tx.QueryRow(ctx, `select id::text from players where invite_code=$1`, strings.ToUpper(strings.TrimSpace(m.InviteCode))).Scan(&other)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fail("no_such_code", "No one has that code")
		}
		if err != nil {
			return nil, err
		}
		if other == player {
			return nil, fail("self_friend", "That is your own code")
		}
		low, high = player, other
		if low > high {
			low, high = high, low
		}
		// Lock the pair even when its friendship row does not exist yet.
		if _, err = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, "friend-pair:"+low+":"+high); err != nil {
			return nil, err
		}
		_, err = tx.Exec(ctx, `insert into friendships(low_id,high_id,requester_id,play_invite,play_timezone) values($1,$2,$3,true,$4) on conflict(low_id,high_id) do nothing`, low, high, player, m.Timezone)
		if err != nil {
			return nil, err
		}
		err = tx.QueryRow(ctx, `select id::text,requester_id::text,status,play_invite,coalesce(play_timezone,'') from friendships where low_id=$1 and high_id=$2 for update`, low, high).Scan(&friendship, &requester, &status, &combined, &zone)
	} else {
		err = tx.QueryRow(ctx, `select low_id::text,high_id::text,requester_id::text,status,play_invite,coalesce(play_timezone,'') from friendships where id=$1 and $2 in(low_id,high_id) for update`, friendship, player).Scan(&low, &high, &requester, &status, &combined, &zone)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail("not_found", "Invitation not found")
	}
	if err != nil {
		return nil, err
	}
	if status == "blocked" {
		return nil, fail("not_found", "Invitation unavailable")
	}
	result := &PlayInvitation{FriendshipID: friendship, Status: status}
	activate := false
	switch action {
	case "create":
		if status == "pending" {
			if requester == player {
				// An existing outgoing legacy request can explicitly become Add & play.
				_, err = tx.Exec(ctx, `update friendships set play_invite=true,play_timezone=$2 where id=$1`, friendship, m.Timezone)
			} else {
				_, err = tx.Exec(ctx, `update friendships set status='accepted',responded_at=$2 where id=$1`, friendship, s.Now())
				result.Status = "accepted"
				activate = combined // A crossed friend-only request still needs game consent.
				if !combined {
					zone = m.Timezone
				}
			}
		} else {
			zone = m.Timezone
		}
	case "accept", "decline":
		if status != "pending" || requester == player || !combined {
			return nil, fail("invalid_action", "Only the invited friend can answer")
		}
		next := "accepted"
		if action == "decline" {
			next = "blocked"
		}
		_, err = tx.Exec(ctx, `update friendships set status=$2,responded_at=$3 where id=$1`, friendship, next, s.Now())
		result.Status = next
		activate = action == "accept"
	case "cancel":
		if status != "pending" || requester != player || !combined {
			return nil, fail("invalid_action", "Only the sender can cancel")
		}
		// No duo references this pending combined request. Receipts survive removal.
		_, err = tx.Exec(ctx, `delete from friendships where id=$1`, friendship)
		result.Status = "cancelled"
	}
	if err != nil {
		return nil, err
	}
	if result.Status == "accepted" {
		var id string
		err = tx.QueryRow(ctx, `select id::text from duos where friendship_id=$1 and status in('pending','active') for update`, friendship).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			state := "pending"
			inviter := player
			if activate {
				inviter = requester
				state = "active"
			}
			start, _, e := dateAt(s.Now(), zone)
			if e != nil {
				return nil, e
			}
			err = tx.QueryRow(ctx, `insert into duos(friendship_id,inviter_id,low_id,high_id,timezone,status,started_on) values($1,$2,$3,$4,$5,$6,case when $6='active' then $7::date end) returning id::text`, friendship, inviter, low, high, zone, state, start).Scan(&id)
		}
		if err != nil {
			return nil, err
		}
		d, e := s.load(ctx, tx, id, player, true)
		if e != nil {
			return nil, e
		}
		// Explicitly inviting an accepted friend who already invited us is consent.
		if d.Status == "pending" && (activate || action == "create" && d.InviterID != player) {
			start, _, _ := dateAt(s.Now(), d.Timezone)
			_, err = tx.Exec(ctx, `update duos set status='active',started_on=$2::date,version=version+1 where id=$1`, id, start)
			if err != nil {
				return nil, err
			}
			d, err = s.load(ctx, tx, id, player, false)
			if err != nil {
				return nil, err
			}
		}
		if err = s.ensureBoard(ctx, tx, d); err != nil {
			return nil, err
		}
		if err = s.populate(ctx, tx, d, false); err != nil {
			return nil, err
		}
		result.Duo = d
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `insert into play_invite_requests(player_id,request_id,fingerprint,response) values($1,$2,$3,$4)`, player, m.RequestID, fingerprint, payload); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}
