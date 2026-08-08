package protocol

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestParseTestdataFrames parses every *.hex frame under ../../testdata. These
// are structurally-valid Codec 8E frames (synthetic today; replaced by real
// bench captures later). The parse must succeed and the CRC must validate.
func TestParseTestdataFrames(t *testing.T) {
	dir := filepath.Join("..", "..", "testdata")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read testdata: %v", err)
	}
	seen := 0
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".hex") {
			continue
		}
		seen++
		t.Run(e.Name(), func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				t.Fatal(err)
			}
			frame, err := hex.DecodeString(strings.TrimSpace(string(raw)))
			if err != nil {
				t.Fatalf("decode hex: %v", err)
			}
			recs, count, err := ParseAVL(frame)
			if err != nil {
				t.Fatalf("ParseAVL: %v", err)
			}
			if int(count) != len(recs) || len(recs) == 0 {
				t.Fatalf("count=%d recs=%d", count, len(recs))
			}
			for i, r := range recs {
				if r.TimestampMs == 0 {
					t.Errorf("record %d has zero timestamp", i)
				}
			}
		})
	}
	if seen == 0 {
		t.Fatal("no .hex testdata frames found")
	}
}
