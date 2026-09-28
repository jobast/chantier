"""data/backlog.json -> supabase/seed.sql (base réelle) et web/seed.json (mode démo)."""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
d = json.loads((ROOT / "data/backlog.json").read_text())

def q(v):
    if v is None: return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, list): return "array[" + ",".join(q(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"

out = ["-- Généré par scripts/gen_seed.py. Ajoutez vos e-mails dans members avant (voir SETUP.md).", "begin;"]
for r in d["rooms"]:
    out.append(f"insert into rooms (id, name, sort) values ({q(r['id'])}, {q(r['name'])}, {r['sort']});")
for t in d["tasks"]:
    out.append("insert into tasks (id, title, lot, kind, priority, minutes, note, depends_on) values "
               f"({q(t['id'])}, {q(t['title'])}, {q(t['lot'])}, {q(t['kind'])}, {q(t['priority'])}, {q(t['minutes'])}, {q(t['note'])}, {q(t['depends_on'])});")
    for r in t["rooms"]:
        out.append(f"insert into task_rooms (task_id, room_id) values ({q(t['id'])}, {q(r)});")
for o in d["options"]:
    out.append(f"insert into options (id, task_id, label) values ({q(o['id'])}, {q(o['task_id'])}, {q(o['label'])});")
for s in d["shopping"]:
    out.append(f"insert into shopping (id, label, qty, store, task_id) values ({q(s['id'])}, {q(s['label'])}, {q(s['qty'])}, {q(s['store'])}, {q(s['task_id'])});")
out.append("commit;")
(ROOT / "supabase/seed.sql").write_text("\n".join(out) + "\n")

demo = {
    "rooms": d["rooms"],
    "tasks": [{k: v for k, v in t.items() if k != "rooms"} | {"assignee": None} for t in d["tasks"]],
    "task_rooms": [{"task_id": t["id"], "room_id": r, "done_at": None, "done_by": None} for t in d["tasks"] for r in t["rooms"]],
    "options": [o | {"price": None, "note": "", "photo": None, "chosen": False} for o in d["options"]],
    "shopping": [s | {"bought_at": None} for s in d["shopping"]],
    "entries": [], "sessions": [], "activity": [],
}
(ROOT / "web").mkdir(exist_ok=True)
(ROOT / "web/seed.json").write_text(json.dumps(demo, ensure_ascii=False))
print("ok", len(out))
