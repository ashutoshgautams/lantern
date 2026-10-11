"""Lantern feedback API (Cloud Run + Firestore).

Visitors navigate fully offline; this service only receives anonymous "I'm lost" / "arrived"
events later, when a phone is back online. Venue admins read a per-path summary on the review
page and fix the hints that confuse people: AI proposes, humans confirm, visitors correct.

POST /api/feedback                 {venue, kind: lost|arrived, from, to, step, edge_from, edge_to}
GET  /api/feedback/summary?venue=  counts per path, for the review page
No personal data is stored: only place ids, step number and time.
"""
import re
from collections import Counter

from flask import Flask, jsonify, request
from google.cloud import firestore

app = Flask(__name__)
db = firestore.Client()
ID = re.compile(r"^[a-z0-9_]{1,64}$")  # same shape as mapper slugs


@app.after_request
def cors(resp):
    # The review page runs on localhost; summaries are anonymous counts, so open read is fine.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.get("/api/health")
def health():
    return {"ok": True}


@app.route("/api/feedback", methods=["POST", "OPTIONS"])
def feedback():
    if request.method == "OPTIONS":
        return "", 204
    d = request.get_json(silent=True) or {}
    ids = [d.get(k) for k in ("venue", "from", "to")] + [d.get(k) for k in ("edge_from", "edge_to") if d.get(k)]
    if d.get("kind") not in ("lost", "arrived") or not all(isinstance(x, str) and ID.match(x) for x in ids):
        return {"error": "bad request"}, 400
    db.collection("feedback").add({
        "venue": d["venue"], "kind": d["kind"], "from": d["from"], "to": d["to"],
        "step": int(d.get("step") or 0), "edge_from": d.get("edge_from"), "edge_to": d.get("edge_to"),
        "at": firestore.SERVER_TIMESTAMP,
    })
    return {"ok": True}, 201


@app.get("/api/feedback/summary")
def summary():
    venue = request.args.get("venue", "")
    if not ID.match(venue):
        return {"error": "bad venue"}, 400
    docs = db.collection("feedback").where(filter=firestore.FieldFilter("venue", "==", venue)).limit(5000).stream()
    lost, kinds = Counter(), Counter()
    for doc in docs:
        f = doc.to_dict()
        kinds[f.get("kind")] += 1
        if f.get("kind") == "lost" and f.get("edge_from") and f.get("edge_to"):
            lost[f"{f['edge_from']}>{f['edge_to']}"] += 1
    return jsonify({
        "venue": venue, "arrived": kinds["arrived"], "lost": kinds["lost"],
        "lost_by_path": [{"from": k.split(">")[0], "to": k.split(">")[1], "count": c} for k, c in lost.most_common()],
    })
