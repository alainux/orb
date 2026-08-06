package tui

import "testing"

func TestEaseOutCubic(t *testing.T) {
	if easeOutCubic(0) != 0 {
		t.Error("easeOutCubic(0) should be 0")
	}
	if easeOutCubic(1) != 1 {
		t.Error("easeOutCubic(1) should be 1")
	}
	// monotonic and bounded
	prev := -1.0
	for i := 0; i <= 10; i++ {
		v := easeOutCubic(float64(i) / 10)
		if v < prev || v < 0 || v > 1 {
			t.Errorf("easeOutCubic(%d/10)=%v out of order/range", i, v)
		}
		prev = v
	}
}

func TestRevealShiftIdentity(t *testing.T) {
	w := 120
	for col := 0; col < w; col++ {
		if got := revealShift(col, 1, w); got != col {
			t.Errorf("revealShift(col=%d,1)=%d, want %d", col, got, col)
		}
	}
}

func TestRevealShiftCollapsesToCenter(t *testing.T) {
	w := 120
	center := w / 2
	for col := 0; col < w; col += 7 {
		if got := revealShift(col, 0, w); got != center {
			t.Errorf("revealShift(%d,0)=%d, want centre %d", col, got, center)
		}
	}
}

func TestRevealShiftMovement(t *testing.T) {
	w := 120
	center := w / 2
	for col := w/2 - 50; col <= w/2+40; col += 3 {
		dist := func(p float64) int {
			v := revealShift(col, p, w)
			d := v - center
			if d < 0 {
				d = -d
			}
			return d
		}
		prev := dist(0)
		for i := 1; i <= 10; i++ {
			d := dist(float64(i) / 10)
			if d < prev {
				t.Errorf("col %d distance from centre not monotonic at p=%d: %d -> %d", col, i, prev, d)
			}
			prev = d
		}
		// fully revealed: back at the column itself.
		if got := revealShift(col, 1, w); got != col {
			t.Errorf("p=1 col %d = %d, want itself", col, got)
		}
	}
}

func TestRevealShiftClampedRange(t *testing.T) {
	w := 40
	for col := 0; col < w; col++ {
		for _, p := range []float64{0, 0.3, 0.7, 1} {
			v := revealShift(col, p, w)
			if v < 0 || v >= w {
				t.Fatalf("revealShift(%d,%v,%d)=%d out of range", col, p, w, v)
			}
		}
	}
}
