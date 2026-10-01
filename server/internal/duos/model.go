package duos

import (
	"time"
	_ "time/tzdata" // Daily boundaries must work even in images without zoneinfo files.
)

type Member struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Entry struct {
	Word       string `json:"word"`
	Register   string `json:"register"`
	Definition string `json:"definition"`
	Note       string `json:"note"`
}
type Guess struct {
	Guess    string   `json:"guess"`
	Marks    []string `json:"marks"`
	PlayerID string   `json:"playerId"`
}
type Day struct {
	DuoID         string    `json:"duoId"`
	Date          string    `json:"date"`
	Deadline      time.Time `json:"deadline"`
	State         string    `json:"state"`
	CurrentPlayer string    `json:"currentPlayer"`
	Version       int       `json:"version"`
	Rows          []Guess   `json:"rows"`
	Passed        []string  `json:"passed"`
	Streak        int       `json:"streak"`
	Answer        string    `json:"answer,omitempty"`
	Entry         *Entry    `json:"entry,omitempty"`
	hiddenAnswer  string
	hiddenEntry   Entry
}
type Duo struct {
	ID           string   `json:"id"`
	FriendshipID string   `json:"friendshipId"`
	InviterID    string   `json:"inviterId"`
	Members      []Member `json:"members"`
	Timezone     string   `json:"timezone"`
	Status       string   `json:"status"`
	Version      int      `json:"version"`
	ViewerID     string   `json:"viewerId"`
	StartedOn    string   `json:"startedOn,omitempty"`
	Today        *Day     `json:"today,omitempty"`
	Recent       []Day    `json:"recent"`
}
type Error struct {
	Code    string
	Message string
	Current *Duo
}

func (e *Error) Error() string        { return e.Message }
func fail(code, message string) error { return &Error{Code: code, Message: message} }

func dateAt(now time.Time, zone string) (string, time.Time, error) {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return "", time.Time{}, err
	}
	t := now.In(loc)
	midnight := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
	return midnight.Format("2006-01-02"), midnight.AddDate(0, 0, 1), nil
}
func starter(start, day string, members []Member) string {
	a, _ := time.Parse("2006-01-02", start)
	b, _ := time.Parse("2006-01-02", day)
	return members[int(b.Sub(a).Hours()/24)%2].ID
}
func streak(states map[string]string, today string) int {
	t, _ := time.Parse("2006-01-02", today)
	if states[today] == "playing" || states[today] == "" {
		t = t.AddDate(0, 0, -1)
	}
	n := 0
	for states[t.Format("2006-01-02")] == "won" {
		n++
		t = t.AddDate(0, 0, -1)
	}
	return n
}
func (d *Day) reveal() {
	if d.State != "playing" {
		d.Answer = d.hiddenAnswer
		e := d.hiddenEntry
		d.Entry = &e
	}
}
