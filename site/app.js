/* textlab — boot the WASM toolkit and wire the three panels.
   All analysis happens in-page; nothing ever leaves the browser. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var TRIAGE_SAMPLE = [
    "2026-07-16T09:14:22Z INFO  starting worker pool size=8",
    "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
    "token: ghp_16C7e42F292c6912E7710c838347Ae178B4a",
    "contact ops@example.com if the deploy at https://ci.example.com/run/42 fails",
    "session 9b2f6c1e-4d3a-4f6b-9d2e-8c1a5b7e0f43 from 203.0.113.7",
    "cache key 3q2+7wA9kPzX1mV5tR8uY0bN4cD6eF7g",
    "plain old log line, nothing to see here"
  ].join("\n");

  var BM25_DOCS = [
    "Okapi BM25 is a bag-of-words ranking function used by search engines to rank documents by relevance to a query.",
    "SimHash is a locality-sensitive hash: similar documents produce hashes with a small Hamming distance.",
    "Reciprocal-rank fusion combines keyword and semantic rankings into a single hybrid search result list.",
    "Shannon entropy measures how random a string looks — API keys and tokens score high, prose scores low.",
    "A perceptual image hash survives resizing and re-encoding, so visually similar images stay close."
  ].join("\n\n");

  var SIM_A = "Dear customer, thank you for your order number 8841 placed on Tuesday. Your package has shipped from our Cape Town warehouse and should arrive within five business days. You can track the delivery at any time from your account page. If anything looks wrong with the order, reply to this email and our support team will sort it out quickly.";
  var SIM_B = "Dear customer, thank you for your order number 9310 placed on Friday. Your package has shipped from our Cape Town warehouse and should arrive within five business days. You can track the delivery at any time from your account page. If anything looks wrong with the order, reply to this email and our support team will sort it out quickly.";

  // --- boot ------------------------------------------------------------------
  var go = new Go();
  var boot = (WebAssembly.instantiateStreaming
    ? WebAssembly.instantiateStreaming(fetch("textlab.wasm"), go.importObject)
    : fetch("textlab.wasm").then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { return WebAssembly.instantiate(b, go.importObject); }))
    .then(function (result) {
      go.run(result.instance);
      return new Promise(function (resolve) {
        (function wait() {
          if (typeof window.tlTriage === "function") return resolve();
          setTimeout(wait, 10);
        })();
      });
    });

  boot.then(function () {
    $("boot-status").textContent = "and it's ready.";
    $("triage-in").value = TRIAGE_SAMPLE;
    $("bm25-docs").value = BM25_DOCS;
    $("bm25-query").value = "hybrid search ranking";
    $("sim-a").value = SIM_A;
    $("sim-b").value = SIM_B;
    runTriage(); runBM25(); runSimHash();
  }).catch(function (err) {
    $("boot-status").textContent = "the WASM failed to load: " + String(err);
  });

  function debounce(fn) {
    var t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, 200); };
  }

  // --- triage ----------------------------------------------------------------
  $("triage-in").addEventListener("input", debounce(runTriage));

  function chip(cls, text) {
    var s = document.createElement("span");
    s.className = "chip " + cls;
    s.textContent = text;
    return s;
  }

  function runTriage() {
    if (typeof window.tlTriage !== "function") return;
    var res = JSON.parse(window.tlTriage($("triage-in").value));
    var rows = $("triage-rows");
    rows.textContent = "";
    var secrets = 0;
    (res.lines || []).forEach(function (l) { secrets += (l.secrets || []).length; });
    $("triage-status").textContent = res.total + " non-empty lines · " + secrets +
      (secrets === 1 ? " secret" : " secrets") + " detected";
    (res.lines || []).forEach(function (l) {
      var tr = document.createElement("tr");
      var no = document.createElement("td");
      no.className = "mono"; no.textContent = String(l.line);
      tr.appendChild(no);
      var td = document.createElement("td");
      var text = document.createElement("div");
      text.className = "mono";
      text.textContent = l.redacted || l.text;
      td.appendChild(text);
      var tags = document.createElement("div");
      if (l.category) tags.appendChild(chip("cat", l.category));
      if (l.highEntropy) tags.appendChild(chip("high", "high entropy"));
      (l.secrets || []).forEach(function (s) {
        tags.appendChild(chip(String(s.severity).toLowerCase() === "critical" ? "crit" : "high",
          s.rule + " · " + String(s.severity).toLowerCase()));
      });
      if (!tags.childNodes.length) tags.appendChild(chip("ok", "clean"));
      td.appendChild(tags);
      tr.appendChild(td);
      var en = document.createElement("td");
      en.className = "num mono";
      en.textContent = l.entropy.toFixed(2);
      tr.appendChild(en);
      rows.appendChild(tr);
    });
  }

  // --- bm25 ------------------------------------------------------------------
  $("bm25-docs").addEventListener("input", debounce(runBM25));
  $("bm25-query").addEventListener("input", debounce(runBM25));

  function runBM25() {
    if (typeof window.tlBM25 !== "function") return;
    var res = JSON.parse(window.tlBM25($("bm25-docs").value, $("bm25-query").value));
    var rows = $("bm25-rows");
    rows.textContent = "";
    if (res.error) { $("bm25-status").textContent = res.error; return; }
    $("bm25-status").textContent = res.docs + " docs indexed · query: “" + res.query + "”";
    var top = res.results.length ? res.results[0].score : 0;
    res.results.forEach(function (r) {
      var tr = document.createElement("tr");
      var id = document.createElement("td");
      id.className = "mono"; id.textContent = r.ID || r.id;
      tr.appendChild(id);
      var p = document.createElement("td");
      p.textContent = r.preview;
      tr.appendChild(p);
      var sc = document.createElement("td");
      sc.className = "num mono";
      var bar = document.createElement("span");
      bar.className = "score-bar";
      bar.style.width = (top > 0 ? Math.max(4, Math.round(48 * r.score / top)) : 4) + "px";
      sc.appendChild(bar);
      sc.appendChild(document.createTextNode(" " + r.score.toFixed(3)));
      tr.appendChild(sc);
      rows.appendChild(tr);
    });
    if (!res.results.length) $("bm25-status").textContent += " · no term matches any document";
  }

  // --- simhash ---------------------------------------------------------------
  $("sim-a").addEventListener("input", debounce(runSimHash));
  $("sim-b").addEventListener("input", debounce(runSimHash));

  function runSimHash() {
    if (typeof window.tlSimHash !== "function") return;
    var res = JSON.parse(window.tlSimHash($("sim-a").value, $("sim-b").value));
    var pct = Math.round(res.similarity * 100);
    $("sim-pct").textContent = pct + "%";
    $("sim-meter").style.width = pct + "%";
    var verdict = res.distance <= 3 ? "near-identical (≤3)"
      : res.distance <= 9 ? "minor edits — near-duplicate territory (≤9)"
      : res.distance >= 28 ? "unrelated prose (~28+ is the random baseline)"
      : "related, but diverging";
    $("sim-detail").textContent = "simhash A " + res.hashA + " · B " + res.hashB +
      " · Hamming distance " + res.distance + "/64 — " + verdict;
  }

  // --- phash -----------------------------------------------------------------
  var phBytes = { a: null, b: null };
  var phTarget = "a";

  ["a", "b"].forEach(function (side) {
    var box = $("ph-" + side);
    box.addEventListener("click", function () { phTarget = side; $("ph-file").click(); });
    box.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); phTarget = side; $("ph-file").click(); }
    });
    ["dragover", "dragenter"].forEach(function (t) {
      box.addEventListener(t, function (e) { e.preventDefault(); box.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (t) {
      box.addEventListener(t, function (e) { e.preventDefault(); box.classList.remove("dragover"); });
    });
    box.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadImage(side, f);
    });
  });
  $("ph-file").addEventListener("change", function () {
    if (this.files.length) loadImage(phTarget, this.files[0]);
    this.value = "";
  });

  function loadImage(side, file) {
    file.arrayBuffer().then(function (buf) {
      phBytes[side] = new Uint8Array(buf);
      var box = $("ph-" + side);
      box.textContent = "";
      var img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.alt = "image " + side.toUpperCase() + ": " + file.name;
      box.appendChild(img);
      runPHash();
    });
  }

  function runPHash() {
    if (!phBytes.a || !phBytes.b || typeof window.tlPHash !== "function") return;
    var res = JSON.parse(window.tlPHash(phBytes.a, phBytes.b));
    if (res.error) {
      $("ph-detail").textContent = res.error;
      $("ph-pct").textContent = "—";
      $("ph-meter").style.width = "0";
      return;
    }
    var pct = Math.round(res.similarity * 100);
    $("ph-pct").textContent = pct + "%";
    $("ph-meter").style.width = pct + "%";
    $("ph-detail").textContent = "phash A " + res.hashA + " · B " + res.hashB +
      " · Hamming distance " + res.distance + "/64" +
      (res.distance <= 10 ? " — likely the same image" : "");
  }
})();
