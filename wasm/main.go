//go:build js && wasm

// Command wasm exposes three zero-dependency text libraries to the browser
// for the textlab playground:
//
//	tlTriage(text)            -> JSON  (triage: per-line classification, entropy, secrets)
//	tlBM25(docs, query)       -> JSON  (bm25: rank blank-line-separated docs for a query)
//	tlSimHash(a, b)           -> JSON  (fingerprint: SimHash distance between two texts)
//	tlPHash(bytesA, bytesB)   -> JSON  (fingerprint: perceptual distance between two images)
//
// Everything runs in-page; no text or image ever leaves the browser.
package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"

	"github.com/richardwooding/bm25"
	"github.com/richardwooding/fingerprint"
	"github.com/richardwooding/triage"
)

// ---- triage ----------------------------------------------------------------

type secretJSON struct {
	Rule     string `json:"rule"`
	Severity string `json:"severity"`
	Match    string `json:"match"`
	Start    int    `json:"start"`
	End      int    `json:"end"`
}

type lineJSON struct {
	Line        int          `json:"line"`
	Text        string       `json:"text"`
	Redacted    string       `json:"redacted,omitempty"`
	Category    string       `json:"category,omitempty"`
	Entropy     float64      `json:"entropy"`
	HighEntropy bool         `json:"highEntropy"`
	Secrets     []secretJSON `json:"secrets,omitempty"`
}

type triageJSON struct {
	Lines       []lineJSON `json:"lines"`
	Interesting int        `json:"interesting"`
	Total       int        `json:"total"`
}

var scanner = triage.NewScanner(triage.WithMinEntropy(4.5))

func runTriage(text string) triageJSON {
	out := triageJSON{Lines: []lineJSON{}}
	for i, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		out.Total++
		r := scanner.Classify([]byte(line))
		lj := lineJSON{
			Line:        i + 1,
			Text:        line,
			Category:    string(r.Category),
			Entropy:     r.Entropy,
			HighEntropy: r.HighEntropy,
		}
		if len(r.Secrets) > 0 {
			lj.Redacted = string(scanner.Redact([]byte(line)))
			for _, s := range r.Secrets {
				lj.Secrets = append(lj.Secrets, secretJSON{
					Rule:     s.Rule,
					Severity: string(s.Severity),
					Match:    s.Match,
					Start:    s.Start,
					End:      s.End,
				})
			}
		}
		if r.Interesting() || r.Category != "" {
			out.Interesting++
		}
		out.Lines = append(out.Lines, lj)
	}
	return out
}

// ---- bm25 ------------------------------------------------------------------

type hitJSON struct {
	ID      string  `json:"id"`
	Preview string  `json:"preview"`
	Score   float64 `json:"score"`
}

type bm25JSON struct {
	Docs    int       `json:"docs"`
	Query   string    `json:"query"`
	Results []hitJSON `json:"results"`
	Error   string    `json:"error,omitempty"`
}

func runBM25(docsText, query string) bm25JSON {
	blocks := []string{}
	for b := range strings.SplitSeq(docsText, "\n\n") {
		if s := strings.TrimSpace(b); s != "" {
			blocks = append(blocks, s)
		}
	}
	out := bm25JSON{Docs: len(blocks), Query: query, Results: []hitJSON{}}
	if len(blocks) == 0 {
		out.Error = "no documents — separate them with a blank line"
		return out
	}
	if strings.TrimSpace(query) == "" {
		out.Error = "type a query to rank the documents"
		return out
	}
	c := bm25.New()
	previews := map[string]string{}
	for i, b := range blocks {
		id := fmt.Sprintf("doc %d", i+1)
		c.Add(id, b)
		p := strings.Join(strings.Fields(b), " ")
		if len(p) > 120 {
			p = p[:120] + "…"
		}
		previews[id] = p
	}
	for _, r := range c.Search(query, len(blocks)) {
		out.Results = append(out.Results, hitJSON{ID: r.ID, Preview: previews[r.ID], Score: r.Score})
	}
	return out
}

// ---- fingerprint -----------------------------------------------------------

type similarityJSON struct {
	HashA      string  `json:"hashA"`
	HashB      string  `json:"hashB"`
	Distance   int     `json:"distance"`
	Similarity float64 `json:"similarity"`
	Error      string  `json:"error,omitempty"`
}

func runSimHash(a, b string) similarityJSON {
	ha, hb := fingerprint.Compute(a), fingerprint.Compute(b)
	return similarityJSON{
		HashA:      fmt.Sprintf("%016x", ha),
		HashB:      fmt.Sprintf("%016x", hb),
		Distance:   fingerprint.Distance(ha, hb),
		Similarity: fingerprint.Similarity(ha, hb),
	}
}

func runPHash(a, b []byte) similarityJSON {
	ha, err := fingerprint.PHash(strings.NewReader(string(a)))
	if err != nil {
		return similarityJSON{Error: "image A: " + err.Error()}
	}
	hb, err := fingerprint.PHash(strings.NewReader(string(b)))
	if err != nil {
		return similarityJSON{Error: "image B: " + err.Error()}
	}
	return similarityJSON{
		HashA:      fingerprint.PHashHex(ha),
		HashB:      fingerprint.PHashHex(hb),
		Distance:   fingerprint.Distance(ha, hb),
		Similarity: fingerprint.Similarity(ha, hb),
	}
}

// ---- plumbing ---------------------------------------------------------------

func marshal(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		eb, _ := json.Marshal(map[string]string{"error": "internal: " + err.Error()})
		return string(eb)
	}
	return string(b)
}

func bytesArg(v js.Value) []byte {
	data := make([]byte, v.Get("length").Int())
	js.CopyBytesToGo(data, v)
	return data
}

func main() {
	js.Global().Set("tlTriage", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) < 1 {
			return marshal(map[string]string{"error": "tlTriage requires (text)"})
		}
		return marshal(runTriage(args[0].String()))
	}))
	js.Global().Set("tlBM25", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) < 2 {
			return marshal(map[string]string{"error": "tlBM25 requires (docs, query)"})
		}
		return marshal(runBM25(args[0].String(), args[1].String()))
	}))
	js.Global().Set("tlSimHash", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) < 2 {
			return marshal(map[string]string{"error": "tlSimHash requires (a, b)"})
		}
		return marshal(runSimHash(args[0].String(), args[1].String()))
	}))
	js.Global().Set("tlPHash", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) < 2 {
			return marshal(map[string]string{"error": "tlPHash requires (bytesA, bytesB)"})
		}
		return marshal(runPHash(bytesArg(args[0]), bytesArg(args[1])))
	}))

	select {} // keep the Go runtime alive for future calls
}
