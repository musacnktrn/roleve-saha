"""[codex] Account ownership, independent customer cards and authenticated team activity."""

import json
import unicodedata


def setup(db):
    columns = {c[1] for c in db.execute("PRAGMA table_info(users)")}
    for key, declaration in (
        ("is_admin", "INTEGER NOT NULL DEFAULT 0"),
        ("active", "INTEGER NOT NULL DEFAULT 1"),
        ("manager_id", "TEXT REFERENCES users(id)"),
    ):
        if key not in columns:
            db.execute("ALTER TABLE users ADD COLUMN " + key + " " + declaration)
    db.execute("CREATE INDEX IF NOT EXISTS users_manager ON users(manager_id)")
    db.execute(
        "CREATE TABLE IF NOT EXISTS customers(owner TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(owner,id))"
    )
    db.execute(
        "CREATE TABLE IF NOT EXISTS project_customers(project TEXT PRIMARY KEY REFERENCES projects(id),id TEXT NOT NULL,name TEXT NOT NULL)"
    )
    if not db.execute(
        "SELECT 1 FROM settings WHERE key='customer_index_v1'"
    ).fetchone():
        for row in db.execute(
            "SELECT v.project,v.doc FROM versions v JOIN projects p ON p.id=v.project AND p.revision=v.rev"
        ):
            try:
                card = customer(json.loads(row["doc"]).get("customer"))
            except (ValueError, TypeError):
                continue
            index_project(db, row["project"], card)
        db.execute("INSERT INTO settings VALUES('customer_index_v1','1')")


def customer(value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("Müşteri kartı geçersiz.")
    cid, name = value.get("id"), value.get("name")
    if (
        not isinstance(cid, str)
        or not (1 <= len(cid) <= 128)
        or not all(c.isascii() and (c.isalnum() or c in "_-") for c in cid)
    ):
        raise ValueError("Müşteri kimliği geçersiz.")
    if not isinstance(name, str):
        raise ValueError("Müşteri adı geçersiz.")
    name = unicodedata.normalize("NFC", name.strip())
    if not 1 <= len(name) <= 240 or any(unicodedata.category(c) == "Cc" for c in name):
        raise ValueError("Müşteri adı 1–240 karakter olmalı.")
    return {"id": cid, "name": name}


def index_project(db, pid, card):
    if card:
        db.execute(
            "INSERT INTO project_customers VALUES (?,?,?) ON CONFLICT(project) DO UPDATE SET id=excluded.id,name=excluded.name",
            (pid, card["id"], card["name"]),
        )
    else:
        db.execute("DELETE FROM project_customers WHERE project=?", (pid,))


def mine(db, actor):
    owned = db.execute(
        "SELECT id,name FROM customers WHERE owner=? ORDER BY name", (actor,)
    )
    rows = {r["id"]: dict(r) for r in owned}
    for row in db.execute(
        """SELECT c.id,c.name FROM project_customers c JOIN projects p ON p.id=c.project JOIN users o ON o.id=p.owner LEFT JOIN grants g ON g.project=p.id AND g.actor=? WHERE p.owner=? OR o.manager_id=? OR g.actor IS NOT NULL ORDER BY p.updated DESC""",
        (actor, actor, actor),
    ):
        rows.setdefault(row["id"], dict(row))
    return sorted(rows.values(), key=lambda r: r["name"].casefold())


def search_text(value):
    decomposed = unicodedata.normalize("NFKD", value.casefold().replace("ı", "i"))
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def work(db, actor, query, offset):
    needle = search_text(query)
    rows = db.execute(
        """SELECT p.id,p.name,p.revision,p.owner,o.name owner_name,v.actor,v.at,v.doc,
                     CASE WHEN w.id=? OR w.manager_id=? THEN w.name END writer
            FROM projects p JOIN users o ON o.id=p.owner JOIN versions v ON v.project=p.id AND v.rev=p.revision
            JOIN users w ON w.id=v.actor WHERE p.owner=? OR o.manager_id=? ORDER BY v.at DESC,p.id""",
        (actor, actor, actor, actor),
    )
    projects = []
    for row in rows:
        doc = json.loads(row["doc"])
        visits = doc.get("visits") or []
        obs = doc.get("observations") or []
        declared = [v.get("person") for v in visits if isinstance(v, dict)] + [
            o.get("measuredBy") for o in obs if isinstance(o, dict)
        ]
        people = sorted(
            {
                name.strip()
                for name in declared
                if isinstance(name, str) and name.strip()
            }
        )
        responsible = doc.get("surveyorName")
        if not isinstance(responsible, str):
            responsible = ""
        card = doc.get("customer") or {}
        customer_name = str(card.get("name") or "") if isinstance(card, dict) else ""
        filter_values = [
            row["name"],
            row["owner_name"],
            row["writer"] or "",
            customer_name,
            responsible,
            *people,
        ]
        projects.append(
            {
                "id": row["id"],
                "name": row["name"],
                "owner": row["owner_name"],
                "revision": row["revision"],
                "at": row["at"],
                "lastWriter": row["writer"],
                "visits": len(visits),
                "observations": len(obs),
                "declaredPeople": people,
                "surveyorName": responsible,
                "customer": customer_name,
                "_matches": not query
                or any(needle in search_text(v) for v in filter_values),
            }
        )
    matches = {p["id"] for p in projects if p["_matches"]}
    activity = []
    skipped = 0
    for row in db.execute(
        """SELECT v.project,p.name projectName,v.rev revision,v.at,w.name username FROM versions v JOIN projects p ON v.project=p.id
                   JOIN users o ON o.id=p.owner JOIN users w ON w.id=v.actor WHERE (p.owner=? OR o.manager_id=?) AND (w.id=? OR w.manager_id=?)
                   ORDER BY v.at DESC,v.project DESC,v.rev DESC""",
        (actor, actor, actor, actor),
    ):
        if row["project"] not in matches and needle not in search_text(row["username"]):
            continue
        if skipped < offset:
            skipped += 1
            continue
        activity.append(dict(row))
        if len(activity) > 80:
            break
    return {
        "projects": [
            {k: v for k, v in p.items() if k != "_matches"}
            for p in projects
            if p["_matches"]
        ],
        "activity": activity[:80],
        "more": len(activity) > 80,
    }
