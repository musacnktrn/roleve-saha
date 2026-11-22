"""Run directly: python3 server/test_api.py. Ephemeral local accounts and SQLite."""

from contextlib import closing
import hashlib
import json
import secrets
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import Server
from vault import CHUNK, MAX_JSON, MAX_MEDIA, MAX_PROJECT_MEDIA, Vault


def sample(pid="test-plan"):
    p = dict(
        schemaVersion=1,
        id=pid,
        name="İki mahal",
        unit="m",
        updatedAt="2026-10-01T10:00:00Z",
    )
    for group in (
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
    ):
        p[group] = []
    return p


class TestPrivateVault(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.db = root / "db" / "private.sqlite3"
        self.vault = Vault(self.db)
        self.password = secrets.token_urlsafe(24)
        for name in ("mimar", "ofis", "harici"):
            self.vault.add_user(name, self.password)
        public = root / "public"
        public.mkdir()
        (public / "index.html").write_text("<title>Test</title>")
        (public / "server").mkdir()
        (public / "server" / "private.js").write_text("")
        (public / "backup.sqlite3").write_bytes(b"")
        self.http = Server(
            ("127.0.0.1", 0), self.vault, ["https://saha.example"], public
        )
        self.url = "http://127.0.0.1:" + str(self.http.server_port)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.a = self.login("mimar")
        self.b = self.login("ofis")
        self.c = self.login("harici")

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, method="GET", body=None, token=None, headers=None):
        h = dict(headers or {})
        if token:
            h["Authorization"] = "Bearer " + token
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        if isinstance(body, bytes):
            h.setdefault("Content-Type", "application/octet-stream")
        req = Request(self.url + path, data=body, headers=h, method=method)
        try:
            resp = urlopen(req, timeout=5)
        except HTTPError as err:
            resp = err
        with resp:
            data = resp.read()
            if resp.headers.get_content_type() == "application/json" and data:
                data = json.loads(data)
            return resp.status, data, resp.headers

    def login(self, name):
        code, result, _ = self.request(
            "/api/login", "POST", dict(username=name, password=self.password)
        )
        self.assertEqual(code, 200, result)
        return result["token"]

    def save(self, p, op="op1", rev=0, token=None):
        return self.request(
            "/api/projects/" + p["id"],
            "PUT",
            dict(base=rev, op=op, document=p),
            token or self.a,
        )[:2]

    def test_login_auth_role_revision_and_replay(self):
        p = sample()
        self.assertEqual(self.request("/api/projects")[0], 401)
        self.assertEqual(self.save(p), (200, dict(revision=1, role="owner")))
        self.assertEqual(self.save(p), (200, dict(revision=1, role="owner")))
        p["name"] = "Saha turu"
        self.assertEqual(self.save(p)[1]["code"], "OP_REUSED")
        self.assertEqual(self.save(p, "op2")[1]["code"], "STALE")
        self.assertEqual(self.save(p, "op2", 1)[1]["revision"], 2)
        self.assertEqual(
            len(self.request("/api/projects/test-plan/versions", token=self.a)[1]), 2
        )
        self.assertEqual(
            self.request("/api/projects/test-plan/versions/1", token=self.a)[1][
                "document"
            ]["name"],
            "İki mahal",
        )
        self.assertEqual(self.request("/api/projects/test-plan", token=self.b)[0], 404)
        self.assertEqual(self.request("/api/projects", token=self.b)[1], [])
        self.assertEqual(
            self.request(
                "/api/projects/test-plan/share",
                "POST",
                dict(username="ofis", role="viewer"),
                self.a,
            )[0],
            200,
        )
        self.assertEqual(self.save(p, "op3", 2, self.b)[0], 403)
        self.assertEqual(
            self.request("/api/projects/test-plan", token=self.b)[1]["role"], "viewer"
        )
        self.assertEqual(
            self.request(
                "/api/projects/test-plan/share",
                "POST",
                dict(username="ofis", role="editor"),
                self.a,
            )[0],
            200,
        )
        self.assertEqual(self.save(p, "op3", 2, self.b)[0], 200)
        self.assertEqual(
            self.request(
                "/api/projects/test-plan/share",
                "POST",
                dict(username="harici", role="viewer"),
                self.b,
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                "/api/projects/test-plan/share",
                "POST",
                dict(username="ofis", role="none"),
                self.a,
            )[0],
            200,
        )
        self.assertEqual(self.request("/api/projects/test-plan", token=self.b)[0], 404)
        self.assertEqual(self.request("/api/logout", "POST", token=self.a)[0], 200)
        self.assertEqual(self.request("/api/projects", token=self.a)[0], 401)

    def test_chunk_resume_atomic_restore_and_project_isolation(self):
        p = sample("media-plan")
        data = b"\x89PNG\r\n\x1a\n" + secrets.token_bytes(CHUNK + 3)
        sha = hashlib.sha256(data).hexdigest()
        p["notes"] = [
            dict(
                id="photo1",
                text="Not",
                photo=dict(
                    name="test.png",
                    data={
                        "$roleveMedia": {
                            "sha256": sha,
                            "size": len(data),
                            "type": "image/png",
                        }
                    },
                ),
            )
        ]
        path = "/api/projects/media-plan/uploads/" + sha
        self.assertEqual(self.save(p)[1]["code"], "UPLOAD_INCOMPLETE")
        self.assertEqual(self.request("/api/projects/media-plan", token=self.a)[0], 404)
        query = "?size=" + str(len(data))
        self.assertEqual(
            self.request(path + "/0" + query, "PUT", data[:CHUNK], self.a)[0], 200
        )
        self.assertEqual(
            self.request(path + "/0" + query, "PUT", data[:CHUNK], self.a)[0], 200
        )
        self.assertEqual(self.request(path, token=self.a)[1]["indices"], [0])
        self.assertEqual(
            self.request(path + "/1" + query, "PUT", data[CHUNK:], self.a)[0], 200
        )
        self.assertEqual(self.save(p)[0], 200)
        self.assertEqual(
            self.request(path, token=self.a)[1], {"complete": True, "indices": []}
        )
        self.assertEqual(
            self.request("/api/projects/media-plan/media/" + sha, token=self.a)[1], data
        )
        self.assertEqual(
            self.request("/api/projects/media-plan/media/" + sha, token=self.c)[0], 404
        )
        copy = Path(self.temp.name) / "copy.sqlite"
        dest = Path(self.temp.name) / "separate.sqlite"
        self.vault.backup(copy)
        with self.assertRaises(FileExistsError):
            self.vault.backup(copy)
        command = [
            sys.executable,
            str(Path(__file__).with_name("server.py")),
            "--db",
            str(dest),
            "restore",
            str(copy),
        ]
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
        self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
        restored = Vault(dest)
        with restored.connection() as backup:
            self.assertEqual(
                backup.execute("PRAGMA integrity_check").fetchone()[0], "ok"
            )
            self.assertEqual(
                backup.execute("SELECT count(*) FROM sessions").fetchone()[0], 0
            )
        cred = restored.login("mimar", self.password, "127.0.0.1")
        self.assertEqual(restored.download(cred["userId"], "media-plan", sha), data)
        self.assertEqual(restored.get(cred["userId"], "media-plan")["document"], p)

    def test_distinct_photo_limits_and_original_formats(self):
        mib = 1024**2

        def ref(key, size, typ="image/heic"):
            return {
                "data": {"$roleveMedia": {"sha256": key, "size": size, "type": typ}}
            }

        self.assertEqual(
            (MAX_JSON, CHUNK, MAX_MEDIA, MAX_PROJECT_MEDIA),
            (24 * mib, 256 * 1024, 40 * mib, 256 * mib),
        )
        p = sample("limits")
        refs = [ref(f"{i:064x}", 40 * mib) for i in range(6)] + [
            ref("6".zfill(64), 16 * mib)
        ]
        p["notes"] = refs * 2
        self.assertEqual(self.save(p)[1]["code"], "UPLOAD_INCOMPLETE")
        p["notes"].append(ref("7".zfill(64), 1))
        self.assertEqual(self.save(p)[0], 400)
        p["notes"] = [ref("1".zfill(64), 40 * mib + 1)]
        self.assertEqual(self.save(p)[0], 400)
        p["notes"] = [ref("1".zfill(64), 1), ref("1".zfill(64), 2)]
        self.assertEqual(self.save(p)[0], 400)
        self.assertEqual(self.request("/api/projects/limits", token=self.a)[0], 404)
        heic = (Path(__file__).parent / "testdata" / "original.heic").read_bytes()
        avif = (Path(__file__).parent / "testdata" / "original.avif").read_bytes()
        p = sample("camera-files")
        base = "/api/projects/camera-files/"
        ks = []
        for body, typ in ((heic, "image/heic"), (avif, "image/avif")):
            sha = hashlib.sha256(body).hexdigest()
            ks.append(sha)
            self.assertEqual(
                self.request(
                    base + "uploads/" + sha + "/0?size=" + str(len(body)),
                    "PUT",
                    body,
                    self.a,
                )[0],
                200,
            )
            p["notes"].append(
                {
                    "id": typ.split("/")[-1],
                    "photo": {"original": ref(sha, len(body), typ)},
                }
            )
        # The HEIF-compatible source is also referenced by its container MIME; storage remains shared.
        p["notes"][0]["photo"]["preview"] = ref(ks[0], len(heic), "image/heif")
        self.assertEqual(self.save(p)[0], 200)
        for sha, source in zip(ks, (heic, avif)):
            status, body, headers = self.request(base + "media/" + sha, token=self.a)
            self.assertEqual(
                (status, body, headers.get_content_type()),
                (200, source, "application/octet-stream"),
            )
            self.assertEqual(self.request(base + "media/" + sha, token=self.b)[0], 404)
        with self.vault.connection() as db:
            self.assertEqual(
                db.execute(
                    "SELECT count(*) FROM media WHERE project=?", (p["id"],)
                ).fetchone()[0],
                2,
            )
        p["notes"][0]["photo"]["original"] = ref(ks[0], len(heic), "image/avif")
        self.assertEqual(self.save(p, "bad-type", 1)[0], 400)
        p["notes"][0]["photo"]["original"] = ref(ks[0], len(heic), "text/html")
        self.assertEqual(self.save(p, "active", 1)[0], 400)
        self.assertEqual(self.request(base + "head", token=self.a)[1]["revision"], 1)

    def test_two_teams_member_admin_customer_and_authenticated_activity(self):
        self.vault.add_user("yonetici", self.password, admin=True)
        self.vault.add_user("yonetici2", self.password, admin=True)
        admin = self.login("yonetici")
        other = self.login("yonetici2")
        mpass = secrets.token_urlsafe(22)
        change = secrets.token_urlsafe(24)
        team = "/api/team"
        cust = "/api/customers"
        m = "ekipmimar"
        m2 = "ekipikimimar"
        self.assertEqual(self.request(team, token=self.a)[0], 403)
        self.assertEqual(
            self.request(team, "POST", {"username": m, "password": "kisa"}, admin)[0],
            400,
        )
        self.assertEqual(
            self.request(
                team, "POST", {"username": m, "password": mpass, "isAdmin": True}, admin
            )[:2],
            (200, {"username": m}),
        )
        self.assertEqual(
            self.request(team, "POST", {"username": m2, "password": mpass}, other)[0],
            200,
        )

        def signin(name, pwd):
            return self.request(
                "/api/login", "POST", {"username": name, "password": pwd}
            )

        member = signin(m, mpass)[1]["token"]
        stranger = signin(m2, mpass)[1]["token"]
        self.assertEqual(self.request(team, token=member)[0], 403)
        self.assertEqual(self.request(team + "/work", token=member)[0], 403)
        self.assertEqual(
            self.request(team, token=admin)[1], [{"username": m, "active": True}]
        )
        self.assertEqual(
            self.request(team + "/members/" + m, "POST", {"action": "disable"}, other)[
                0
            ],
            404,
        )
        empty = {"id": "boskart", "name": "Özel müşteri"}
        self.assertEqual(
            self.request(cust + "/boskart", "PUT", empty, member)[1], empty
        )
        self.assertEqual(self.request(cust, token=admin)[1], [])
        first = sample("saha-ekibi")
        first["customer"] = {"id": "proje-musteri", "name": "Saha müşterisi"}
        first["visits"] = [{"id": "v", "person": "Beyan adı"}]
        first["surveyorName"] = "İrem Güneş"
        first["observations"] = [
            {"id": "o", "measuredBy": "Ölçen", "recordedBy": "Sahte sunucu yazarı"}
        ]
        self.assertEqual(self.save(first, token=member)[0], 200)
        second = sample("diger-ekip")
        second["customer"] = {"id": "diger", "name": "Diğer ekip müşterisi"}
        self.assertEqual(self.save(second, token=stranger)[0], 200)
        self.assertEqual(self.request("/api/projects/diger-ekip", token=admin)[0], 404)
        self.assertEqual(self.request("/api/projects/saha-ekibi", token=other)[0], 404)
        self.assertEqual(
            self.request("/api/projects/saha-ekibi", token=admin)[1]["role"], "viewer"
        )
        self.assertEqual(self.save(first, "forbidden", 1, admin)[0], 403)
        self.assertEqual(self.request(cust, token=admin)[1], [first["customer"]])
        self.assertEqual(self.request(cust, token=other)[1], [second["customer"]])
        self.assertEqual(
            self.request(cust, token=member)[1],
            sorted([empty, first["customer"]], key=lambda c: c["name"].casefold()),
        )
        report = self.request(team + "/work", token=admin)[1]
        self.assertEqual([p["id"] for p in report["projects"]], [first["id"]])
        p = report["projects"][0]
        self.assertEqual(
            (
                p["lastWriter"],
                p["owner"],
                p["visits"],
                p["observations"],
                p["declaredPeople"],
            ),
            (m, m, 1, 1, ["Beyan adı", "Ölçen"]),
        )
        self.assertEqual(p["surveyorName"], "İrem Güneş")
        self.assertEqual(
            self.request(team + "/work?q=irem", token=admin)[1]["projects"][0]["id"],
            first["id"],
        )
        self.assertEqual(
            self.request(team + "/work?q=olcen", token=admin)[1]["projects"][0]["id"],
            first["id"],
        )
        self.assertEqual(
            self.request(team + "/work?q=Sahte", token=admin)[1]["projects"], []
        )
        self.assertEqual(report["activity"][0]["username"], m)
        self.assertEqual(
            self.request(team + "/work?q=absent", token=admin)[1]["projects"], []
        )
        self.assertEqual(
            self.request(
                "/api/projects/saha-ekibi/share",
                "POST",
                {"username": m2, "role": "editor"},
                member,
            )[0],
            200,
        )
        self.assertEqual(self.save(first, "shared-work", 1, stranger)[0], 200)
        safe = self.request(team + "/work", token=admin)[1]
        self.assertIsNone(safe["projects"][0]["lastWriter"])
        self.assertEqual([v["username"] for v in safe["activity"]], [m])
        self.assertEqual(
            self.request("/api/projects/saha-ekibi/versions", token=admin)[1][0][
                "username"
            ],
            "Paylaşımlı kullanıcı",
        )
        distant = self.request(team + "/work", token=other)[1]
        self.assertFalse(any(v["project"] == first["id"] for v in distant["activity"]))
        self.assertEqual(self.request("/api/projects/saha-ekibi", token=other)[0], 404)
        self.assertEqual(
            self.request(
                team + "/members/" + m,
                "POST",
                {"action": "reset", "password": change},
                admin,
            )[0],
            200,
        )
        self.assertEqual(self.request(cust, token=member)[0], 401)
        self.assertEqual(signin(m, mpass)[0], 401)
        member = signin(m, change)[1]["token"]
        self.assertEqual(
            self.request(team + "/members/" + m, "POST", {"action": "disable"}, admin)[
                0
            ],
            200,
        )
        self.assertEqual(self.request(cust, token=member)[0], 401)
        self.assertEqual(signin(m, change)[0], 401)
        self.assertEqual(
            self.request(team + "/work", token=admin)[1]["projects"][0]["id"],
            first["id"],
        )
        self.assertEqual(
            self.request(team + "/members/" + m, "POST", {"action": "enable"}, admin)[
                0
            ],
            200,
        )
        self.assertEqual(signin(m, change)[0], 200)

    def test_explicit_admin_bootstrap_and_legacy_migration(self):
        import sqlite3

        dest = Path(self.temp.name) / "legacy.sqlite3"
        with closing(sqlite3.connect(dest)) as legacy, legacy:
            legacy.execute(
                "CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt BLOB NOT NULL,pwhash BLOB NOT NULL)"
            )
            legacy.execute(
                "INSERT INTO users VALUES(?,?,?,?)",
                ("original", "eski", bytes(16), bytes(32)),
            )
        pwd = secrets.token_urlsafe(22)
        run = subprocess.run(
            [
                sys.executable,
                "-B",
                str(Path(__file__).with_name("server.py")),
                "--db",
                str(dest),
                "user-add",
                "ilk-yonetici",
                "--admin",
            ],
            input=pwd + "\n" + pwd + "\n",
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(run.returncode, 0)
        self.assertNotIn(pwd, run.stdout + run.stderr)
        v = Vault(dest)
        self.assertTrue(v.login("ilk-yonetici", pwd, "127.0.0.1")["isAdmin"])
        with v.connection() as db:
            self.assertEqual(
                tuple(
                    db.execute(
                        "SELECT is_admin,active,manager_id FROM users WHERE id=?",
                        ("original",),
                    ).fetchone()
                ),
                (0, 1, None),
            )

    def test_origin_static_limits_and_simultaneous_writer(self):
        self.assertEqual(self.request("/index.html")[0], 200)
        self.assertEqual(self.request("/server/private.js")[0], 404)
        self.assertEqual(self.request("/backup.sqlite3")[0], 404)
        self.assertEqual(
            self.request("/api/health", headers={"Origin": "https://wrong.example"})[0],
            403,
        )
        code, body, headers = self.request(
            "/api/health", "OPTIONS", headers={"Origin": "https://saha.example"}
        )
        self.assertEqual(code, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://saha.example")
        p = sample()
        self.save(p)
        start = threading.Barrier(2)
        codes = []

        def writer(name):
            start.wait()
            codes.append(self.save({**p, "name": name}, name, 1)[0])

        ts = [threading.Thread(target=writer, args=(name,)) for name in ("a", "b")]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(sorted(codes), [200, 409])


if __name__ == "__main__":
    unittest.main(verbosity=2)
