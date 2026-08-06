package audio

import (
	"fmt"

	"github.com/alainux/orb/errs"
)

// classifyStartErr maps a raw capture/device failure into a classified errs
// error (spec R11 AC-11.3) so the caller can react by kind instead of string
// matching.
//
//   - A transient device condition (e.g. "busy", "try again") degrades to text
//     mode rather than exiting (non-fatal).
//   - A hard mic permission denial is fatal.
//   - Any unrecognised capture failure is still a mic/device problem, so it is
//     surfaced as a fatal mic error rather than being silently swallowed.
//
// A nil input yields nil.
func classifyStartErr(err error) *errs.Error {
	if err == nil {
		return nil
	}
	ce := errs.Classify(fmt.Errorf("mic capture: %w", err))
	if ce.Kind != errs.KindMic {
		// Classify fell through to another kind (e.g. internal) — normalise it
		// to a mic/device failure (AC-11.3) so the degraded/exit path stays
		// consistent for the whole capture path.
		return errs.Wrap(errs.KindMic, errs.MsgMicDenied, err, true)
	}
	return ce
}