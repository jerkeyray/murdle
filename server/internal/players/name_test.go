package players

import (
	"strings"
	"testing"
)

// The validation is worth its own test because it is the only thing standing
// between a bookplate and a name that does not fit on one.
func TestNameLimits(t *testing.T) {
	cases := []struct {
		name string
		in   string
		ok   bool
	}{
		{"ordinary", "Rohan", true},
		{"trimmed", "  Rohan  ", true},
		{"one character", "R", true},
		{"sixteen characters", strings.Repeat("a", 16), true},
		{"seventeen is too many", strings.Repeat("a", 17), false},
		{"empty", "", false},
		{"only spaces", "   ", false},
		{"newline", "Ro\nhan", false},
		{"tab", "Ro\that", false},
		// Measured in runes, not bytes: this is five characters and fifteen
		// bytes, and rejecting it would be wrong.
		{"devanagari", "रोहन", true},
		{"emoji within the limit", "rohan 🦊", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			trimmed := strings.TrimSpace(tc.in)
			n := len([]rune(trimmed))
			valid := n >= MinNameLength && n <= MaxNameLength &&
				!strings.ContainsAny(trimmed, "\n\r\t")
			if valid != tc.ok {
				t.Errorf("%q accepted=%v, want %v (%d runes)", tc.in, valid, tc.ok, n)
			}
		})
	}
}
