"""Rölöve Saha private SQLite vault. No runtime dependencies outside Python."""

import contextlib
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

import team

MAX_JSON = 24 * 1024 * 1024
MAX_MEDIA = 40 * 1024 * 1024
MAX_PROJECT_MEDIA = 256 * 1024 * 1024
CHUNK = 256 * 1024
IMAGE_HEADER_BYTES = 128 * 1024
MAX_STAGING = 2 * MAX_PROJECT_MEDIA
TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/heic",
    "image/heif",
    "application/pdf",
    "audio/mp4",
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/mpeg",
}
ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
GROUPS = (
    "floors",
    "nodes",
    "walls",
    "rooms",
    "elements",
    "zones",
    "observations",
    "notes",
    "visits",
    "strokes",
    "underlays",
)


class Problem(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def require(value, message, code="INVALID"):
    if not value:
        raise Problem(400, code, message)


def stamp():
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def encode(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def user_name(name):
    require(isinstance(name, str), "Kullanıcı adını girin.")
    name = unicodedata.normalize("NFKC", name).strip().casefold()
    require(
        1 <= len(name) <= 100 and all(c.isalnum() or c in "._@-+" for c in name),
        "Kullanıcı adı geçersiz.",
    )
    return name


def password_hash(password, salt):
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**15,
        r=8,
        p=1,
        maxmem=64 * 1024 * 1024,
        dklen=32,
    )


def identifier(value):
    require(isinstance(value, str) and ID.fullmatch(value), "Kayıt kimliği geçersiz.")
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def image_type_matches(typ, header):
    if typ == "image/jpeg":
        return header.startswith(b"\xff\xd8\xff")
    if typ == "image/png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if typ == "image/gif":
        return header.startswith((b"GIF87a", b"GIF89a"))
    if typ == "image/webp":
        return header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    if typ not in ("image/avif", "image/heif", "image/heic"):
        return True
    start = 0
    while start + 8 <= len(header):
        size = int.from_bytes(header[start:start+4], "big")
        kind = header[start+4:start+8]
        body = start + 8
        if size == 1:
            if body + 8 > len(header):
                return False
            size = int.from_bytes(header[body:body+8], "big")
            body += 8
        end = start + size if size else len(header)
        if end > len(header) or end < body:
            return False
        if kind == b"ftyp":
            if end - body < 8 or (end - body) % 4:
                return False
            brands = {header[body:body+4]}
            brands.update(header[i:i+4] for i in range(body+8, end, 4))
            break
        if kind not in (b"free", b"skip", b"wide"):
            return False
        start = end
    else:
        return False
    avif = {b"avif", b"avis"}
    heic = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs"}
    if typ == "image/avif":
        return bool(brands & avif)
    if typ == "image/heic":
        return bool(brands & heic)
    return bool(brands & (heic | avif | {b"heif", b"mif1", b"miaf", b"msf1"}))


class Vault:
    def __init__(self, path):
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not self.path.exists():
            handle = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
            os.close(handle)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,
                                                salt BLOB NOT NULL,pwhash BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL
                    REFERENCES users(id),until INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,hits INTEGER NOT NULL,
                                                        start INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),
                                                     revision INTEGER NOT NULL,name TEXT NOT NULL,updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS grants(project TEXT NOT NULL REFERENCES projects(id),
                    actor TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('editor','viewer')),
                    PRIMARY KEY(project,actor));
                CREATE TABLE IF NOT EXISTS versions(project TEXT NOT NULL REFERENCES projects(id),
                    rev INTEGER NOT NULL,actor TEXT NOT NULL REFERENCES users(id),at TEXT NOT NULL,doc BLOB NOT NULL,
                    PRIMARY KEY(project,rev));
                CREATE TABLE IF NOT EXISTS operations(project TEXT NOT NULL REFERENCES projects(id),
                    actor TEXT NOT NULL REFERENCES users(id),op TEXT NOT NULL,fingerprint TEXT NOT NULL,rev INTEGER NOT NULL,
                    PRIMARY KEY(project,actor,op));
                CREATE TABLE IF NOT EXISTS media(project TEXT NOT NULL REFERENCES projects(id),hash TEXT NOT NULL,
                    body BLOB NOT NULL,PRIMARY KEY(project,hash));
                CREATE TABLE IF NOT EXISTS staging(actor TEXT NOT NULL REFERENCES users(id),project TEXT NOT NULL,
                    hash TEXT NOT NULL,idx INTEGER NOT NULL,size INTEGER NOT NULL,at INTEGER NOT NULL,body BLOB NOT NULL,
                    PRIMARY KEY(actor,project,hash,idx));
            """)
            db.execute(
                "INSERT OR IGNORE INTO settings VALUES ('instance',?)",
                (str(uuid.uuid4()),),
            )
        with self.connection(True) as db:
            team.setup(db)

    @contextlib.contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.path, timeout=12, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            if write:
                db.commit()
        finally:
            db.close()

    @staticmethod
    def admin(db, actor):
        if not db.execute(
            "SELECT 1 FROM users WHERE id=? AND is_admin=1 AND active=1", (actor,)
        ).fetchone():
            raise Problem(403, "ADMIN_REQUIRED", "Bu işlem ekip yöneticisine ait.")

    def add_user(self, name, password, *, admin=False, manager=None):
        name = user_name(name)
        require(
            isinstance(password, str) and 12 <= len(password) <= 1024,
            "Parola 12–1024 karakter içermeli.",
        )
        if manager:
            with self.connection() as db:
                self.admin(db, manager)
        salt = secrets.token_bytes(16)
        verifier = password_hash(password, salt)
        with self.connection(True) as db:
            if manager:
                self.admin(db, manager)
            if db.execute("SELECT 1 FROM users WHERE name=?", (name,)).fetchone():
                raise Problem(409, "USER_EXISTS", "Bu kullanıcı adı zaten var.")
            db.execute(
                "INSERT INTO users(id,name,salt,pwhash,is_admin,manager_id) VALUES (?,?,?,?,?,?)",
                (str(uuid.uuid4()), name, salt, verifier, int(admin), manager),
            )
        return name

    def login(self, name, password, address):
        name = user_name(name)
        require(
            isinstance(password, str) and 0 < len(password) <= 1024, "Parola geçersiz."
        )
        now = int(time.time())
        keys = (
            ("ip:" + digest(address.encode()), 48),
            ("u:" + digest(name.encode()), 12),
        )
        with self.connection(True) as db:
            db.execute("DELETE FROM login_limits WHERE start<=?", (now - 300,))
            for key, ceiling in keys:
                count = db.execute(
                    "SELECT hits FROM login_limits WHERE key=?", (key,)
                ).fetchone()
                if count and count[0] >= ceiling:
                    raise Problem(
                        429, "RETRY_LATER", "Kısa süre sonra yeniden deneyin."
                    )
            for key, _ in keys:
                db.execute(
                    "INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1",
                    (key, now),
                )
            row = db.execute("SELECT * FROM users WHERE name=?", (name,)).fetchone()
        got = password_hash(password, row["salt"] if row else bytes(16))
        if not row or not row["active"] or not hmac.compare_digest(got, row["pwhash"]):
            raise Problem(
                401, "LOGIN_FAILED", "Kullanıcı adı veya parola doğrulanamadı."
            )
        token = secrets.token_urlsafe(40)
        with self.connection(True) as db:
            if not db.execute(
                "SELECT 1 FROM users WHERE id=? AND active=1 AND pwhash=?",
                (row["id"], got),
            ).fetchone():
                raise Problem(
                    401, "LOGIN_FAILED", "Kullanıcı adı veya parola doğrulanamadı."
                )
            db.execute("DELETE FROM sessions WHERE until<=?", (now,))
            db.execute("DELETE FROM login_limits WHERE key=?", (keys[1][0],))
            db.execute(
                "INSERT INTO sessions VALUES (?,?,?)",
                (digest(token.encode()), row["id"], now + 8 * 3600),
            )
            instance = db.execute(
                "SELECT value FROM settings WHERE key='instance'"
            ).fetchone()[0]
        return dict(
            token=token,
            username=name,
            userId=row["id"],
            instance=instance,
            isAdmin=bool(row["is_admin"]),
        )

    def auth(self, token):
        if token and len(token) <= 128:
            with self.connection() as db:
                row = db.execute(
                    "SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.active=1 AND s.token_hash=? AND s.until>?",
                    (digest(token.encode()), int(time.time())),
                ).fetchone()
                if row:
                    return row[0]
        raise Problem(401, "LOGIN_REQUIRED", "Sunucu oturumunu yeniden açın.")

    def logout(self, token):
        with self.connection(True) as db:
            db.execute(
                "DELETE FROM sessions WHERE token_hash=?", (digest(token.encode()),)
            )

    @staticmethod
    def role(db, actor, pid, *, write=False, create=False):
        identifier(pid)
        row = db.execute(
            """SELECT projects.owner,grants.role,u.manager_id FROM projects JOIN users u ON u.id=projects.owner LEFT JOIN grants
                            ON grants.project=projects.id AND grants.actor=? WHERE projects.id=?""",
            (actor, pid),
        ).fetchone()
        if not row and create:
            return "owner"
        role = (
            (
                "owner"
                if row["owner"] == actor
                else row["role"] or ("viewer" if row["manager_id"] == actor else None)
            )
            if row
            else None
        )
        if role is None:
            raise Problem(404, "NOT_FOUND", "Proje bu hesapta bulunamadı.")
        if write and role == "viewer":
            raise Problem(403, "READ_ONLY", "Proje bu hesapla salt okunur.")
        return role

    def listings(self, actor):
        with self.connection() as db:
            rows = db.execute(
                """SELECT p.id,p.name,p.revision,p.updated as updatedAt,
                       CASE WHEN p.owner=? THEN 'owner' ELSE coalesce(g.role,'viewer') END role FROM projects p JOIN users o ON o.id=p.owner
                       LEFT JOIN grants g ON p.id=g.project AND g.actor=? WHERE p.owner=? OR o.manager_id=? OR g.role IS NOT NULL ORDER BY p.updated DESC""",
                (actor, actor, actor, actor),
            )
            return [dict(row) for row in rows]

    def share(self, actor, pid, target, role):
        target = user_name(target)
        require(role in ("none", "editor", "viewer"), "Erişim rolü geçersiz.")
        with self.connection(True) as db:
            if self.role(db, actor, pid) != "owner":
                raise Problem(403, "OWNER_REQUIRED", "Erişimi proje sahibi yönetir.")
            row = db.execute("SELECT id FROM users WHERE name=?", (target,)).fetchone()
            if not row:
                raise Problem(
                    404, "NO_USER", "Önce sunucu yöneticisi bu hesabı açmalı."
                )
            require(row[0] != actor, "Proje sahibinin erişimi korunur.")
            if role == "none":
                db.execute(
                    "DELETE FROM grants WHERE project=? AND actor=?", (pid, row[0])
                )
                db.execute(
                    "DELETE FROM staging WHERE project=? AND actor=?", (pid, row[0])
                )
            else:
                db.execute(
                    "INSERT INTO grants VALUES (?,?,?) ON CONFLICT(project,actor) DO UPDATE SET role=excluded.role",
                    (pid, row[0], role),
                )
        return {"username": target, "role": role}

    def members(self, actor):
        with self.connection() as db:
            self.admin(db, actor)
            return [
                {"username": r["name"], "active": bool(r["active"])}
                for r in db.execute(
                    "SELECT name,active FROM users WHERE manager_id=? ORDER BY name",
                    (actor,),
                )
            ]

    def member_change(self, actor, name, action, password=None):
        name = user_name(name)
        require(action in ("reset", "disable", "enable"), "Üye işlemi geçersiz.")
        with self.connection(True) as db:
            self.admin(db, actor)
            member = db.execute(
                "SELECT id FROM users WHERE name=? AND manager_id=? AND is_admin=0",
                (name, actor),
            ).fetchone()
            if not member:
                raise Problem(404, "NO_MEMBER", "Ekip üyesi bulunamadı.")
            if action == "reset":
                require(
                    isinstance(password, str) and 12 <= len(password) <= 1024,
                    "Parola 12–1024 karakter içermeli.",
                )
                salt = secrets.token_bytes(16)
                db.execute(
                    "UPDATE users SET salt=?,pwhash=? WHERE id=?",
                    (salt, password_hash(password, salt), member[0]),
                )
            else:
                db.execute(
                    "UPDATE users SET active=? WHERE id=?",
                    (int(action == "enable"), member[0]),
                )
            if action != "enable":
                db.execute("DELETE FROM sessions WHERE user_id=?", (member[0],))
        return {"username": name, "action": action}

    def team_work(self, actor, query, offset=0):
        require(isinstance(query, str) and len(query) <= 160, "Arama metni çok uzun.")
        with self.connection() as db:
            self.admin(db, actor)
            return team.work(db, actor, query, offset)

    def customers(self, actor):
        with self.connection() as db:
            return team.mine(db, actor)

    def customer_put(self, actor, cid, packet):
        card = team.customer({"id": cid, "name": packet.get("name")})
        with self.connection(True) as db:
            previous = db.execute(
                "SELECT name FROM customers WHERE owner=? AND id=?", (actor, cid)
            ).fetchone()
            if previous and previous[0] != card["name"]:
                raise Problem(
                    409, "CUSTOMER_EXISTS", "Müşteri kimliği farklı bir adla kayıtlı."
                )
            db.execute(
                "INSERT OR IGNORE INTO customers VALUES(?,?,?)",
                (actor, cid, card["name"]),
            )
        return card

    def head(self, actor, pid):
        with self.connection() as db:
            role = self.role(db, actor, pid)
            rev = db.execute(
                "SELECT revision FROM projects WHERE id=?", (pid,)
            ).fetchone()[0]
            return {"revision": rev, "role": role}

    def get(self, actor, pid, rev=None):
        with self.connection() as db:
            role = self.role(db, actor, pid)
            row = db.execute(
                "SELECT rev,doc,at FROM versions WHERE project=? AND (? IS NULL OR rev=?) ORDER BY rev DESC LIMIT 1",
                (pid, rev, rev),
            ).fetchone()
            if not row:
                raise Problem(404, "NO_VERSION", "Sürüm bulunamadı.")
            return {
                "revision": row["rev"],
                "document": json.loads(row["doc"]),
                "role": role,
                "at": row["at"],
            }

    def history(self, actor, pid):
        with self.connection() as db:
            self.role(db, actor, pid)
            managed = db.execute(
                "SELECT 1 FROM projects p JOIN users o ON o.id=p.owner WHERE p.id=? AND o.manager_id=?",
                (pid, actor),
            ).fetchone()
            return [
                dict(row)
                for row in db.execute(
                    """SELECT v.rev AS revision,v.at,
                      CASE WHEN ? AND u.id<>? AND coalesce(u.manager_id,'')<>? THEN 'Paylaşımlı kullanıcı' ELSE u.name END AS username
                      FROM versions v JOIN users u ON u.id=v.actor WHERE v.project=? ORDER BY v.rev DESC""",
                    (int(bool(managed)), actor, actor, pid),
                )
            ]

    def upload_status(self, actor, pid, key):
        require(SHA.fullmatch(key), "Dosya kimliği geçersiz.")
        with self.connection() as db:
            self.role(db, actor, pid, write=True, create=True)
            done = db.execute(
                "SELECT 1 FROM media WHERE project=? AND hash=?", (pid, key)
            ).fetchone()
            rows = db.execute(
                "SELECT idx FROM staging WHERE actor=? AND project=? AND hash=? ORDER BY idx",
                (actor, pid, key),
            )
            return {"complete": bool(done), "indices": [r[0] for r in rows]}

    def chunk(self, actor, pid, key, index, size, data):
        require(
            SHA.fullmatch(key)
            and 0 < size <= MAX_MEDIA
            and 0 <= index < (size + CHUNK - 1) // CHUNK,
            "Dosya parçası geçersiz.",
        )
        require(len(data) == min(CHUNK, size - index * CHUNK), "Eksik dosya parçası.")
        now = int(time.time())
        with self.connection(True) as db:
            self.role(db, actor, pid, write=True, create=True)
            if db.execute(
                "SELECT 1 FROM media WHERE project=? AND hash=?", (pid, key)
            ).fetchone():
                return {"stored": True}
            db.execute("DELETE FROM staging WHERE at<?", (now - 2 * 86400,))
            previous = db.execute(
                "SELECT body,size FROM staging WHERE actor=? AND project=? AND hash=? AND idx=?",
                (actor, pid, key, index),
            ).fetchone()
            if previous:
                require(
                    previous["body"] == data and previous["size"] == size,
                    "Yinelenen dosya parçası farklı.",
                )
                return {"stored": True}
            count = db.execute(
                "SELECT coalesce(sum(length(body)),0) FROM staging WHERE actor=?",
                (actor,),
            ).fetchone()[0]
            if count + len(data) > MAX_STAGING:
                raise Problem(413, "STAGING_FULL", "Bekleyen dosya alanı doldu.")
            db.execute(
                "INSERT INTO staging VALUES (?,?,?,?,?,?,?)",
                (actor, pid, key, index, size, now, data),
            )
        return {"stored": True}

    @staticmethod
    def collect_refs(doc):
        refs = {}
        total = 0

        def inspect(item, depth=0, field=None):
            nonlocal total
            require(depth <= 48, "Dosya iç içe veri sınırını aşıyor.")
            if isinstance(item, dict):
                if "$roleveMedia" in item:
                    ref = item["$roleveMedia"]
                    require(
                        field == "data"
                        and len(item) == 1
                        and isinstance(ref, dict)
                        and isinstance(ref.get("sha256"), str)
                        and SHA.fullmatch(ref["sha256"])
                        and type(ref.get("size")) is int
                        and 0 < ref["size"] <= MAX_MEDIA
                        and ref.get("type") in TYPES,
                        "Dosya bildirimi geçersiz.",
                    )
                    sha, size, typ = ref["sha256"], ref["size"], ref["type"]
                    if sha in refs:
                        known_size, types = refs[sha]
                        require(known_size == size, "Dosya boyutları çelişiyor.")
                        types.add(typ)
                    else:
                        total += size
                        require(
                            total <= MAX_PROJECT_MEDIA,
                            "Proje ekleri 256 MiB sınırını aşıyor.",
                        )
                        refs[sha] = (size, {typ})
                else:
                    for key, value in item.items():
                        require(
                            key
                            not in (
                                "__proto__",
                                "prototype",
                                "constructor",
                                "$roleveLocalFile",
                            ),
                            "Özellik adı geçersiz.",
                        )
                        inspect(value, depth + 1, key)
            elif isinstance(item, list):
                for child in item:
                    inspect(child, depth + 1)
            elif isinstance(item, str) and field == "data":
                require(
                    not item.lower().startswith("data:"),
                    "Medya parça olarak gönderilmeli.",
                )

        inspect(doc)
        return refs

    def save(self, actor, pid, packet):
        require(isinstance(packet, dict), "Gönderim geçersiz.")
        op = identifier(packet.get("op"))
        base = packet.get("base")
        require(type(base) is int and base >= 0, "Sürüm geçersiz.")
        doc = packet.get("document")
        require(
            isinstance(doc, dict)
            and type(doc.get("schemaVersion")) is int
            and doc["schemaVersion"] == 1
            and doc.get("id") == pid,
            "Proje biçimi desteklenmiyor.",
        )
        require(
            isinstance(doc.get("name"), str) and 0 < len(doc["name"].strip()) <= 500,
            "Proje adı geçersiz.",
        )
        for group in GROUPS:
            require(isinstance(doc.get(group), list), "Eksik proje grubu: " + group)
        card = team.customer(doc.get("customer"))
        raw = encode(doc)
        require(len(raw) <= MAX_JSON, "Proje boyutu sınırı aşıldı.")
        refs = self.collect_refs(doc)
        fingerprint = digest(str(base).encode() + b"\0" + raw)
        with self.connection(True) as db:
            role = self.role(db, actor, pid, write=True, create=True)
            recorded = db.execute(
                "SELECT rev,fingerprint FROM operations WHERE project=? AND actor=? AND op=?",
                (pid, actor, op),
            ).fetchone()
            if recorded:
                if recorded["fingerprint"] != fingerprint:
                    raise Problem(
                        409,
                        "OP_REUSED",
                        "İşlem kimliği başka bir içerik için kullanılmış.",
                    )
                return {"revision": recorded["rev"], "role": role}
            row = db.execute(
                "SELECT revision FROM projects WHERE id=?", (pid,)
            ).fetchone()
            revision = row[0] if row else 0
            if base != revision:
                raise Problem(409, "STALE", "Sunucuda daha yeni bir sürüm var.")
            at = stamp()
            if not row:
                db.execute(
                    "INSERT INTO projects VALUES (?,?,?,?,?)",
                    (pid, actor, 1, doc["name"], at),
                )
            for key, (size, types) in refs.items():
                complete = db.execute(
                    "SELECT length(body),substr(body,1,?) FROM media WHERE project=? AND hash=?",
                    (IMAGE_HEADER_BYTES, pid, key),
                ).fetchone()
                if complete:
                    require(complete[0] == size, "Dosya boyutu uyuşmuyor.")
                    require(
                        all(image_type_matches(typ, complete[1]) for typ in types),
                        "Fotoğraf dosyasının türü uyuşmuyor.",
                    )
                    continue
                parts = db.execute(
                    "SELECT idx,size,body FROM staging WHERE actor=? AND project=? AND hash=? ORDER BY idx",
                    (actor, pid, key),
                ).fetchall()
                if len(parts) != (size + CHUNK - 1) // CHUNK or any(
                    p["idx"] != i or p["size"] != size for i, p in enumerate(parts)
                ):
                    raise Problem(
                        409, "UPLOAD_INCOMPLETE", "Bazı fotoğraf parçaları bekliyor."
                    )
                body = b"".join(p["body"] for p in parts)
                require(
                    len(body) == size and hmac.compare_digest(digest(body), key),
                    "Dosya bütünlüğü doğrulanamadı.",
                )
                require(
                    all(image_type_matches(typ, body[:IMAGE_HEADER_BYTES]) for typ in types),
                    "Fotoğraf dosyasının türü uyuşmuyor.",
                )
                db.execute("INSERT INTO media VALUES (?,?,?)", (pid, key, body))
                db.execute(
                    "DELETE FROM staging WHERE actor=? AND project=? AND hash=?",
                    (actor, pid, key),
                )
            team.index_project(db, pid, card)
            revision += 1
            db.execute(
                "UPDATE projects SET revision=?,name=?,updated=? WHERE id=?",
                (revision, doc["name"], at, pid),
            )
            db.execute(
                "INSERT INTO versions VALUES (?,?,?,?,?)",
                (pid, revision, actor, at, raw),
            )
            db.execute(
                "INSERT INTO operations VALUES (?,?,?,?,?)",
                (pid, actor, op, fingerprint, revision),
            )
        return {"revision": revision, "role": role}

    def download(self, actor, pid, key):
        require(SHA.fullmatch(key), "Dosya kimliği geçersiz.")
        with self.connection() as db:
            self.role(db, actor, pid)
            row = db.execute(
                "SELECT body FROM media WHERE project=? AND hash=?", (pid, key)
            ).fetchone()
            if not row:
                raise Problem(404, "NO_MEDIA", "Dosya bulunamadı.")
            return row[0]

    def backup(self, destination):
        destination = Path(destination).expanduser()
        handle = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        os.close(handle)
        try:
            with (
                self.connection() as src,
                contextlib.closing(sqlite3.connect(destination)) as target,
            ):
                src.backup(target)
                target.execute("DELETE FROM sessions")
                target.execute("DELETE FROM login_limits")
                target.execute("DELETE FROM staging")
                target.commit()
                if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Yedek bütünlüğü doğrulanamadı.")
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
