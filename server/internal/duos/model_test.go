package duos

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestCalendarAndStarter(t *testing.T) {
	for _, tc := range []struct{ now, zone, date, deadline string }{
		{"2026-10-01T19:00:00Z", "Asia/Kolkata", "2026-10-02", "2026-10-02T18:30:00Z"},
		{"2026-03-08T05:00:00Z", "America/New_York", "2026-03-08", "2026-03-09T04:00:00Z"},
		{"2026-11-01T04:00:00Z", "America/New_York", "2026-11-01", "2026-11-02T05:00:00Z"},
	} {
		now, _ := time.Parse(time.RFC3339, tc.now)
		day, end, err := dateAt(now, tc.zone)
		if err != nil || day != tc.date || end.UTC().Format(time.RFC3339) != tc.deadline {
			t.Fatalf("calendar: %s %v %v", day, end, err)
		}
	}
	members := []Member{{"a", "A"}, {"b", "B"}}
	if starter("2026-03-07", "2026-03-08", members) != "b" || starter("2026-03-07", "2026-03-09", members) != "a" {
		t.Fatal("starter must follow calendar dates")
	}
	states := map[string]string{"2026-10-01": "playing", "2026-09-30": "won", "2026-09-29": "won"}
	if streak(states, "2026-10-01") != 2 {
		t.Fatal("pending day erased streak")
	}
	states["2026-10-01"] = "won"
	if streak(states, "2026-10-01") != 3 {
		t.Fatal("win did not extend")
	}
	states["2026-10-01"] = "lost"
	if streak(states, "2026-10-01") != 0 || streak(states, "2026-10-03") != 0 {
		t.Fatal("missed day did not break")
	}
}
func TestSafeDay(t *testing.T) {
	d := Day{State: "playing", hiddenAnswer: "voice", hiddenEntry: Entry{Definition: "hidden definition"}}
	d.reveal()
	b, _ := json.Marshal(d)
	if strings.Contains(string(b), "voice") || strings.Contains(string(b), "definition") {
		t.Fatal("hidden answer escaped")
	}
	d.State = "expired"
	d.reveal()
	if d.Answer != "voice" || d.Entry == nil {
		t.Fatal("completed entry missing")
	}
}
