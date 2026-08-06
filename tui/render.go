package tui

import (
	"strconv"
	"strings"

	"github.com/gdamore/tcell/v2"
)

// hexColor converts an "#RRGGBB" palette string into a tcell color.
func hexColor(hex string) tcell.Color {
	return tcell.NewHexColor(parseHex(hex))
}

// parseHex parses an "#RRGGBB" string into a 24-bit int. Returns 0 on junk.
func parseHex(hex string) int32 {
	h := strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(h) != 6 {
		return 0
	}
	v, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return 0
	}
	return int32(v)
}

// nearest returns one of the given candidate hex colors that is visually
// closest to the target, used for 256-color approximations (AC-9.2: Ember →
// warm orange, Tide → blue). Candidates are weighted toward color harmony.
func nearest(target string, candidates []string) string {
	tr, tg, tb := parseRGB(target)
	best := candidates[0]
	bestDist := int(^uint(0) >> 1) // max int
	for _, c := range candidates {
		r, g, b := parseRGB(c)
		d := (int(tr)-int(r))*(int(tr)-int(r)) + (int(tg)-int(g))*(int(tg)-int(g)) + (int(tb)-int(b))*(int(tb)-int(b))
		if d < bestDist {
			bestDist = d
			best = c
		}
	}
	return best
}

func parseRGB(hex string) (int32, int32, int32) {
	v := parseHex(hex)
	return (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff
}

// styleCache reuses styles per hex pairing to avoid reparse churn.
type styleCache map[string]tcell.Style

func (sc styleCache) style(hex string, bg string) tcell.Style {
	key := hex + "|" + bg
	if s, ok := sc[key]; ok {
		return s
	}
	s := tcell.StyleDefault
	if hex != "" {
		s = s.Foreground(hexColor(hex))
	}
	if bg != "" {
		s = s.Background(hexColor(bg))
	}
	sc[key] = s
	return s
}
