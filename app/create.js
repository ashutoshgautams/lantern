// Create a map, entirely in the browser:
// walkthrough video -> sampled photos + narration audio -> Gemini (Firebase AI Logic) -> human review
// -> published to Firestore -> shareable link + QR signs. Loaded only on #/create, so visitors never download it.
// Uses helpers from app.js (render, btn, icon, esc, enc, say, getConfig, firestoreBase, loadVenue, loadScript).

const FB = "https://www.gstatic.com/firebasejs/13.0.0/";
const TYPES = ["entrance", "room", "corridor", "junction", "stairs", "lift", "washroom", "canteen", "office", "exit", "other"];
const MAX_SECONDS = 600;
const MAX_FRAMES = 60;   // ~60 small photos keeps the whole request well under Gemini's inline limit
let draft = null;        // { name, file, duration, every, frames, audio, graph, photos, publishedId }

const bar = (back) => `<nav class="topbar" aria-label="Back and home">
  ${btn(back, "arrow_back_ios_new", "Back", "nav")}${btn("#/", "home", "Home", "nav")}</nav>`;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "place";
const screenEl = () => app.querySelector(".screen");

export function show(parts, token) {
  const [step, id] = parts;
  if (!step) return form();
  if (step === "working" && draft && draft.file) return working(token);
  if (step === "review" && draft && draft.graph) return review();
  if (step === "done" && id) return done(id);
  location.replace("#/create");
}

// ---------- 1. Form ----------
function form() {
  render(`${bar("#/")}
    <h1>Map a building</h1>
    <p class="lead">Walk through once, filming with your phone and saying what you see.
      Gemini turns it into step-by-step photo directions anyone can use, even offline.</p>
    <ul class="card tips">
      <li>${icon("check")}<span>Walk slowly and hold the phone at chest height.</span></li>
      <li>${icon("check")}<span>Say each place out loud: “This is the library”.</span></li>
      <li>${icon("check")}<span>Pause for 3 seconds facing each door or sign.</span></li>
    </ul>
    <form id="mk" novalidate>
      <label class="field"><span>Building name</span>
        <input class="input" name="name" maxlength="80" autocomplete="off" placeholder="e.g. City Hospital"
          value="${esc(draft ? draft.name : "")}"></label>
      <label class="picker">
        <span class="ic">${icon("videocam")}</span>
        <span><span class="t" id="pk-t">${draft && draft.file ? esc(draft.file.name) : "Choose or record a video"}</span>
        <span class="s" id="pk-s">Up to 10 minutes</span></span>
        <input type="file" name="video" accept="video/*">
      </label>
      <p class="small" style="margin-top:0.7rem">Small photos from your video and its sound are sent to Google Gemini to make the map.
        Nothing is shared until you check it and press Publish.</p>
      <div id="err" role="alert"></div>
      <button class="btn filled xl" type="submit">${icon("auto_awesome")}<span>Make my map</span></button>
    </form>`, "Map a building");
  const f = app.querySelector("#mk");
  f.video.addEventListener("change", () => {
    const file = f.video.files[0];
    if (file) { app.querySelector("#pk-t").textContent = file.name; app.querySelector("#pk-s").textContent = `${Math.round(file.size / 1e6)} MB`; }
  });
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    const file = f.video.files[0] || (draft && draft.file);
    const err = (m) => { app.querySelector("#err").innerHTML = `<p class="alert">${m}</p>`; };
    if (!name) return err("Please type the building name.");
    if (!file) return err("Please choose or record a video.");
    draft = { name, file };
    location.hash = "#/create/working";
  });
}

// ---------- 2. Working ----------
const STEPS = [
  ["read", "Opening your video"],
  ["frames", "Picking photos from the walk"],
  ["audio", "Listening to what you said"],
  ["ai", "Gemini is drawing the map"],
  ["photos", "Taking a photo of each place"],
];

async function working(token) {
  render(`${bar("#/create")}
    <h1>Making your map</h1>
    <p class="lead">This takes a minute or two. Please keep this screen open.</p>
    <ol class="card progress-list">${STEPS.map(([id, label]) =>
      `<li id="st-${id}"><span class="st"><span class="dot"></span></span><span><span class="lbl">${label}</span>
       <span class="small" id="sd-${id}"></span></span></li>`).join("")}</ol>
    <div id="err" role="alert"></div>`, "Making your map");
  const alive = () => token === screenToken;
  const set = (id, state, detail) => {
    const li = app.querySelector(`#st-${id}`);
    if (!li) return;
    li.className = state;
    li.querySelector(".st").innerHTML = state === "done" ? icon("check") : state === "active" ? `<span class="spinner"></span>` : `<span class="dot"></span>`;
    if (detail !== undefined) app.querySelector(`#sd-${id}`).textContent = detail ? ` · ${detail}` : "";
    if (state === "active") say(li.querySelector(".lbl").textContent);
  };
  const fail = (msg) => {
    if (!alive()) return;
    app.querySelector("#err").innerHTML = `<p class="alert">${esc(msg)}</p>${btn("#/create", "arrow_back", "Back to the form", "filled")}`;
  };

  const d = draft;
  const video = document.createElement("video");
  try {
    set("read", "active");
    video.muted = true; video.playsInline = true; video.preload = "auto";
    video.src = URL.createObjectURL(d.file);
    await once(video, "loadedmetadata");
    try { await video.play(); video.pause(); } catch (e) { /* some browsers need this before seeking */ }
    d.duration = video.duration;
    if (!isFinite(d.duration) || d.duration < 3) throw new Error("This video could not be opened. Please try another one.");
    if (d.duration > MAX_SECONDS) throw new Error("This video is longer than 10 minutes. Please film a shorter walk.");
    set("read", "done", `${Math.round(d.duration)} seconds`);

    set("frames", "active");
    d.every = Math.max(2, Math.ceil(d.duration / MAX_FRAMES));
    d.frames = [];
    for (let t = 0.5; t < d.duration; t += d.every) {
      if (!alive()) return;
      await seek(video, t);
      d.frames.push({ t: Math.round(t), data: grab(video, 512, 0.6) });
      set("frames", "active", `${d.frames.length} of ${Math.ceil(d.duration / d.every)}`);
    }
    set("frames", "done", `${d.frames.length} photos`);

    set("audio", "active");
    try { d.audio = await narration(d.file); set("audio", "done"); }
    catch (e) { d.audio = null; set("audio", "done", "no sound found, using photos only"); }
    if (!alive()) return;

    set("ai", "active");
    d.graph = await askGemini(d);
    if (!alive()) return;
    if (!d.graph.nodes.length) throw new Error("Gemini could not find any places. Try a slower walk and say each place out loud.");
    set("ai", "done", `${d.graph.nodes.length} places, ${d.graph.edges.length} paths`);

    set("photos", "active");
    d.photos = {};
    for (const n of d.graph.nodes) {
      if (!alive()) return;
      await seek(video, Math.min(Math.max(0.2, n.timestamp_sec), d.duration - 0.2));
      d.photos[n.id] = grab(video, 800, 0.72);
    }
    set("photos", "done");
    location.hash = "#/create/review";
  } catch (e) {
    fail(e.message || "Something went wrong. Please try again.");
  } finally {
    URL.revokeObjectURL(video.src);
  }
}

function once(el, ev) {
  return new Promise((ok, bad) => {
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener("error", () => bad(new Error("This video could not be opened on this phone. Try recording at 1080p or 720p.")), { once: true });
  });
}
function seek(video, t) {
  return new Promise((ok) => {
    const done = () => { clearTimeout(timer); ok(); };
    const timer = setTimeout(done, 4000); // never hang on a stubborn frame
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = t;
  });
}
function grab(video, width, quality) {
  const c = document.createElement("canvas");
  c.width = Math.min(width, video.videoWidth || width);
  c.height = Math.round(c.width * (video.videoHeight || 9) / (video.videoWidth || 16));
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality).split(",")[1];
}

// Narration -> small mono WAV (16 kHz, or 8 kHz for long walks: plenty for speech) -> base64.
async function narration(file) {
  if (file.size > 600e6) throw new Error("too big to decode");
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  ctx.close();
  const rate = decoded.duration > 300 ? 8000 : 16000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const buf = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => [...s].forEach((ch, i) => buf.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); buf.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVEfmt ");
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  str(36, "data"); buf.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return toBase64(new Uint8Array(buf.buffer));
}
function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- Gemini via Firebase AI Logic (no server, no API key in the page) ----------
const PROMPT = (every) => `You are building an indoor navigation map from ONE walkthrough of a venue.
Above are photos taken every ${every} seconds of the walk (each labelled with its second) and the walker's narration audio.
The walker says place names out loud. Use the photos AND the narration.

NODES = distinct places a visitor might want to go to or pass through: entrances, exits, rooms,
corridor junctions/turns, stairs, lifts, washrooms, canteens, offices, notable landmarks.
- id: short lowercase snake_case, unique (e.g. "main_entrance", "room_104").
- name: what a visitor would call it, short, as narrated ("Room 104", "Main Entrance").
- type: one of the allowed types. Use "junction" for corridor crossings/turns.
- floor: e.g. "Ground", "1", "2". Infer from narration or stairs/lift use.
- timestamp_sec: the photo second where the place is seen most clearly (use one of the labelled seconds).
- step_free: true if a wheelchair user can reach it without stairs.
- visual_cue: one short sentence on how to recognise the spot.
If the walker comes back to a place ("back at the main corridor"), it must be ONE node. Never duplicate places.

EDGES = direct walkable connections between two nodes, in walking order (from -> to).
- approx_steps: estimated walking steps (about 1 step per second of walking).
- hint_forward: plain, short instruction from -> to using landmarks ("Turn left after the notice board").
- hint_backward: the correct instruction to -> from: a left going forward is a RIGHT going back,
  "go up the stairs" becomes "go down the stairs". Do not just copy.
- has_stairs: true if this connection uses stairs.
Every node must be connected to at least one other node. Use simple words a grandmother understands.`;

async function askGemini(d) {
  const cfg = await getConfig();
  const { initializeApp, getApps } = await import(FB + "firebase-app.js");
  const { getAI, getGenerativeModel, GoogleAIBackend, Schema: S } = await import(FB + "firebase-ai.js");
  const fbApp = getApps()[0] || initializeApp(cfg.firebase);
  const ai = getAI(fbApp, { backend: new GoogleAIBackend() });
  const schema = S.object({ properties: {
    nodes: S.array({ items: S.object({ properties: {
      id: S.string(), name: S.string(), type: S.enumString({ enum: TYPES }), floor: S.string(),
      timestamp_sec: S.number(), step_free: S.boolean(), visual_cue: S.string() } }) }),
    edges: S.array({ items: S.object({ properties: {
      from: S.string(), to: S.string(), approx_steps: S.integer(),
      hint_forward: S.string(), hint_backward: S.string(), has_stairs: S.boolean() } }) }),
  } });
  const parts = [];
  d.frames.forEach((f) => parts.push({ text: `Photo at ${f.t}s` }, { inlineData: { mimeType: "image/jpeg", data: f.data } }));
  if (d.audio) parts.push({ text: "Narration audio of the whole walk:" }, { inlineData: { mimeType: "audio/wav", data: d.audio } });
  parts.push({ text: PROMPT(d.every) });

  let lastErr;
  for (const name of cfg.geminiModels) {
    const model = getGenerativeModel(ai, { model: name, generationConfig: {
      responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 } });
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await model.generateContent(parts);
        d.model = name;
        return clean(JSON.parse(res.response.text()), d.duration);
      } catch (e) {
        lastErr = e;
        const msg = String(e && e.message);
        if (/404|not found|not supported/i.test(msg)) break;          // try the next model name
        if (!/429|503|500|overload|unavailable|quota/i.test(msg)) throw friendly(e);
        await new Promise((r) => setTimeout(r, 4000 * attempt));       // busy: wait and retry
      }
    }
  }
  throw friendly(lastErr);
}
function friendly(e) {
  const msg = String(e && e.message);
  if (/api.?key|permission|403|not been used|disabled|requires the Firebase AI API|api-not-enabled/i.test(msg)) return new Error("Map making isn't switched on for this app yet (Firebase AI Logic). Please try again later.");
  if (/429|quota/i.test(msg)) return new Error("Gemini is busy right now. Please wait a minute and try again.");
  return new Error("Gemini could not make the map. Please try again.");
}

// Same safety net as the Python mapper: unique ids, valid references, no duplicate or self paths.
function clean(g, duration) {
  const ids = new Set(), remap = {}, nodes = [], edges = [], seen = new Set();
  for (const n of g.nodes || []) {
    const base = slug(n.id || n.name);
    let id = base, i = 2;
    while (ids.has(id)) id = `${base}_${i++}`;
    ids.add(id);
    if (!(n.id in remap)) remap[n.id] = id;
    nodes.push({ id, name: String(n.name || id).trim(), type: TYPES.includes(n.type) ? n.type : "other", floor: String(n.floor || ""),
      timestamp_sec: Math.min(Math.max(0, Number(n.timestamp_sec) || 0), duration), step_free: n.step_free !== false,
      visual_cue: String(n.visual_cue || "").trim() });
  }
  for (const e of g.edges || []) {
    const a = remap[e.from], b = remap[e.to], key = [a, b].sort().join("|");
    if (!a || !b || a === b || seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: a, to: b, approx_steps: Math.max(1, parseInt(e.approx_steps, 10) || 10),
      hint_forward: String(e.hint_forward || "").trim(), hint_backward: String(e.hint_backward || "").trim(), has_stairs: !!e.has_stairs });
  }
  return { nodes, edges };
}

// ---------- 3. Review ----------
function review() {
  const { graph, photos, name } = draft;
  const nameOf = (id) => esc((graph.nodes.find((n) => n.id === id) || {}).name || id);
  render(`${bar("#/create")}
    <h1>Check your map</h1>
    <p class="lead">Gemini found ${graph.nodes.length} places and ${graph.edges.length} paths in ${esc(name)}.
      Fix anything that looks wrong, then publish.</p>
    ${graph.nodes.map((n, i) => `<div class="card place-edit">
      ${photos[n.id] ? `<img src="data:image/jpeg;base64,${photos[n.id]}" alt="">` : `<div class="noimg">${icon("photo_camera")}</div>`}
      <div class="fields">
        <label class="sr-only" for="pn${i}">Place name</label>
        <input class="input" id="pn${i}" data-i="${i}" data-k="name" value="${esc(n.name)}">
        <label class="sr-only" for="pt${i}">Type of place</label>
        <select class="input" id="pt${i}" data-i="${i}" data-k="type">${TYPES.map((t) =>
          `<option value="${t}" ${t === n.type ? "selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select>
        <button class="btn danger" type="button" data-del="${i}">${icon("delete")}<span>Remove</span></button>
      </div></div>`).join("")}
    <details class="card"><summary>Directions between places (${graph.edges.length})</summary>
      ${graph.edges.map((e, i) => `<div class="edge-edit">
        <label for="hf${i}"><b>${nameOf(e.from)} → ${nameOf(e.to)}</b></label>
        <textarea class="input" id="hf${i}" data-e="${i}" data-k="hint_forward">${esc(e.hint_forward)}</textarea>
        <label for="hb${i}"><b>${nameOf(e.to)} → ${nameOf(e.from)}</b></label>
        <textarea class="input" id="hb${i}" data-e="${i}" data-k="hint_backward">${esc(e.hint_backward)}</textarea>
      </div>`).join("")}
    </details>
    <div id="err" role="alert"></div>
    <button class="btn filled xl" type="button" id="pub">${icon("publish")}<span>Publish map</span></button>
    ${btn("#/create", "arrow_back", "Start over", "text")}`, "Check your map");

  const root = screenEl();
  root.addEventListener("input", (e) => {
    const t = e.target, k = t.dataset.k;
    if (!k) return;
    const obj = t.dataset.i !== undefined ? graph.nodes[t.dataset.i] : graph.edges[t.dataset.e];
    if (obj) obj[k] = t.value;
  });
  root.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      const gone = graph.nodes.splice(+del.dataset.del, 1)[0];
      graph.edges = graph.edges.filter((x) => x.from !== gone.id && x.to !== gone.id);
      return review();
    }
    if (e.target.closest("#pub")) publish(e.target.closest("#pub"));
  });
}

// ---------- 4. Publish to Firestore (REST; rules allow create-only, size-limited documents) ----------
async function publish(button) {
  const { graph, photos, name } = draft;
  if (graph.nodes.length < 2) return showErr("A map needs at least two places.");
  button.disabled = true;
  button.querySelector("span:last-child").textContent = "Publishing…";
  try {
    const cfg = await getConfig();
    const fs = firestoreBase(cfg), key = cfg.firebase.apiKey;
    const id = `${slug(name).slice(0, 40)}_${Math.random().toString(36).slice(2, 8)}`;
    const map = {
      venue: { id, name, app_url: location.origin },
      generated_by: `${draft.model} via Firebase AI Logic`,
      nodes: graph.nodes.map(({ timestamp_sec, ...n }) => ({ ...n, keyframe: { video: draft.file.name, timestamp_sec } })),
      edges: graph.edges,
    };
    const post = async (path, docId, fields) => {
      const r = await fetch(`${fs}/${path}?documentId=${enc(docId)}&key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
      if (!r.ok) throw new Error(`publish failed (${r.status})`);
    };
    await post("maps", id, { name: { stringValue: name }, map: { stringValue: JSON.stringify(map) },
      places: { integerValue: String(map.nodes.length) }, created: { timestampValue: new Date().toISOString() } });
    let n = 0;
    for (const node of map.nodes) {
      if (photos[node.id]) await post(`maps/${id}/photos`, node.id, { data: { bytesValue: photos[node.id] } });
      button.querySelector("span:last-child").textContent = `Publishing… ${++n} of ${map.nodes.length}`;
    }
    draft.publishedId = id;
    location.hash = `#/create/done/${id}`;
  } catch (e) {
    button.disabled = false;
    button.querySelector("span:last-child").textContent = "Publish map";
    showErr("Could not publish right now. Check your internet and try again.");
  }
}
function showErr(m) { const el = app.querySelector("#err"); if (el) el.innerHTML = `<p class="alert">${esc(m)}</p>`; }

// ---------- 5. Done: share link, QR, printable signs ----------
async function done(id) {
  const url = `${location.origin}${location.pathname}#/venue/${enc(id)}`;
  if (!window.qrcode) await loadScript("vendor/qrcode.js");
  render(`${bar("#/")}
    <div class="arrived"><div class="empty"><div class="ic" style="background:var(--ok-soft);color:var(--ok)">${icon("check")}</div></div>
      <h1>Your map is live</h1>
      <p class="lead">Anyone with this link gets step-by-step directions. After their first visit it works without internet.</p></div>
    <div class="card share">
      <div class="qr" role="img" aria-label="QR code for the map link">${qrSvg(url)}</div>
      <p class="link">${esc(url)}</p>
      <div class="row2">
        ${navigator.share ? `<button class="btn tonal" type="button" id="share">${icon("share")}<span>Share link</span></button>` : ""}
        <button class="btn" type="button" id="copy">${icon("content_copy")}<span>Copy link</span></button>
      </div>
    </div>
    ${btn(`#/venue/${enc(id)}`, "map", "Open the map", "filled xl")}
    <button class="btn" type="button" id="print">${icon("print")}<span>Print “You are here” signs</span></button>
    <p class="small" id="msg" role="status"></p>`, "Your map is live");
  const root = screenEl();
  root.addEventListener("click", async (e) => {
    if (e.target.closest("#share")) { try { await navigator.share({ title: "Lantern map", url }); } catch (err) { /* cancelled */ } }
    if (e.target.closest("#copy")) {
      try { await navigator.clipboard.writeText(url); app.querySelector("#msg").textContent = "Link copied."; }
      catch (err) { app.querySelector("#msg").textContent = url; }
    }
    if (e.target.closest("#print")) printSigns(id);
  });
}
function qrSvg(text) {
  const q = window.qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
async function printSigns(id) {
  const v = await loadVenue(id);
  const base = `${location.origin}${location.pathname}#/venue/${enc(id)}/here/`;
  const pages = v.map.nodes.map((n) => `<section><p class="venue">${esc(v.map.venue.name)}</p><h1>You are here</h1>
    <div class="q">${qrSvg(base + enc(n.id))}</div><p class="name">${esc(n.name)}</p>
    <p class="how">Scan with your phone camera for directions. Works without internet.</p></section>`).join("");
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Signs – ${esc(v.map.venue.name)}</title><style>
    @page { size: A4; margin: 15mm; } body { margin: 0; font-family: system-ui, sans-serif; text-align: center; color: #101828; }
    section { height: 265mm; display: flex; flex-direction: column; align-items: center; justify-content: center; page-break-after: always; }
    .q svg { width: 130mm; height: 130mm; } h1 { font-size: 40pt; margin: 0 0 8mm; } .venue { font-size: 18pt; margin: 0 0 4mm; color: #3d4757; }
    .name { font-size: 46pt; font-weight: 800; margin: 8mm 0 4mm; } .how { font-size: 17pt; margin: 0; }
  </style></head><body>${pages}<script>onload = () => print();<\/script></body></html>`);
  w.document.close();
}
