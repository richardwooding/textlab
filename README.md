# textlab

**Three zero-dependency Go text libraries, live in your browser** —
[richardwooding.github.io/textlab](https://richardwooding.github.io/textlab/)

One page, three panels, all running as WebAssembly in the browser — nothing is uploaded:

- **[triage](https://github.com/richardwooding/triage)** — paste anything and each line is
  classified (URL, email, UUID, hex, …), entropy-scored, and scanned for secrets with the
  default rules; detected secrets are shown redacted.
- **[bm25](https://github.com/richardwooding/bm25)** — paste blank-line-separated documents and
  a query; the corpus is re-indexed and re-ranked on every keystroke.
- **[fingerprint](https://github.com/richardwooding/fingerprint)** — two texts compared by
  64-bit SimHash (with the library's documented distance bands), and two dropped images compared
  by perceptual hash.

All three libraries were extracted from
[file-search-on](https://github.com/richardwooding/file-search-on); the whole WASM binary is
~1.2 MB gzipped.

## Layout

- `wasm/` — the Go→WASM wrapper: exposes `tlTriage`, `tlBM25`, `tlSimHash`, `tlPHash` on `window`.
- `site/` — the static page (GitHub Pages): [gloam](https://github.com/richardwooding/gloam)-styled
  UI. `textlab.wasm` and `wasm_exec.js` are built by CI, not committed.
- `.github/workflows/deploy.yml` — builds the WASM and deploys `site/` to Pages on push.

## Build locally

```sh
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o site/textlab.wasm ./wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" site/
python3 -m http.server -d site 8080   # then open http://localhost:8080
```

## License

MIT — see [LICENSE](LICENSE).
