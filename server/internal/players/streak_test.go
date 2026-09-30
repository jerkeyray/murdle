package players

import (
	"testing"
	"time"
)

// days builds a descending list of calendar days from offsets before today.
func days(today time.Time, offsets ...int) []time.Time {
	out := make([]time.Time, len(offsets))
	for i, o := range offsets {
		out[i] = day(today.AddDate(0, 0, -o))
	}
	return out
}

func TestComputeStreak(t *testing.T) {
	today := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)

	cases := []struct {
		name    string
		offsets []int
		want    Streak
	}{
		{"never played", nil, Streak{}},
		{
			"played today only",
			[]int{0},
			Streak{Current: 1, Longest: 1, PlayedToday: true},
		},
		{
			"three days ending today",
			[]int{0, 1, 2},
			Streak{Current: 3, Longest: 3, PlayedToday: true},
		},
		{
			// Still alive: there is the rest of today to play.
			"ended yesterday is still running",
			[]int{1, 2, 3},
			Streak{Current: 3, Longest: 3, PlayedToday: false},
		},
		{
			"a two day gap breaks it",
			[]int{2, 3, 4},
			Streak{Current: 0, Longest: 3, PlayedToday: false},
		},
		{
			"longest survives a broken current",
			[]int{5, 6, 7, 8, 20},
			Streak{Current: 0, Longest: 4, PlayedToday: false},
		},
		{
			"current and longest can differ",
			[]int{0, 1, 10, 11, 12, 13},
			Streak{Current: 2, Longest: 4, PlayedToday: true},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := computeStreak(days(today, tc.offsets...), today)
			if got != tc.want {
				t.Errorf("computeStreak(%v) = %+v, want %+v", tc.offsets, got, tc.want)
			}
		})
	}
}

// The bug this test exists for: a round played at 00:21 in Delhi is filed
// under the local date, and comparing it against the server's UTC date made
// the streak read as broken for several hours every night.
func TestComputeStreakUsesCalendarDaysNotElapsedTime(t *testing.T) {
	delhi := time.FixedZone("IST", 5*60*60+30*60)
	justAfterMidnight := time.Date(2026, 10, 1, 0, 21, 0, 0, delhi)

	played := []time.Time{day(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC))}

	got := computeStreak(played, justAfterMidnight)
	if !got.PlayedToday {
		t.Error("a round played just after local midnight should count as today")
	}
	if got.Current != 1 {
		t.Errorf("Current = %d, want 1", got.Current)
	}
}
