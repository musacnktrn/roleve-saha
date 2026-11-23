#!/usr/bin/env python3
"""Rölöve Saha HTTP API and administration CLI."""

import argparse
from contextlib import closing
import getpass
import json
import mimetypes
import os
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from vault import CHUNK, MAX_JSON, Problem, Vault, encode, require


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, vault, origins=(), static=None):
        self.vault = vault
        self.origins = set(origins)
        self.static = Path(static).resolve() if static else None
        self.capacity = threading.BoundedSemaphore(16)
        super().__init__(address, Handler)

    def process_request(self, request, address):
        request.settimeout(20)
        if not self.capacity.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.capacity.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.capacity.release()

    def handle_error(self, request, client_address):
        pass  # request contents, credentials and paths are private


def integer(value):
    require(
        isinstance(value, str)
        and value.isascii()
        and value.isdigit()
        and len(value) <= 12,
        "Sayı geçersiz.",
    )
    return int(value)


class Handler(BaseHTTPRequestHandler):
    server_version = "Roleve"
    sys_version = ""

    def log_message(self, fmt, *args):
        pass

    def origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return None
        host = self.headers.get("Host", "")
        if origin in self.server.origins or origin in (
            "http://" + host,
            "https://" + host,
        ):
            return origin
        raise Problem(403, "ORIGIN", "Bu web adresine sunucu erişimi tanımlanmamış.")

    def send_body(
        self, code, data=b"", typ="application/json; charset=utf-8", cors=None
    ):
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Cache-Control", "no-store" if self.path.startswith("/api/") else "no-cache"
        )
        self.send_header("Vary", "Origin")
        if cors:
            self.send_header("Access-Control-Allow-Origin", cors)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers", "Authorization, Content-Type"
            )
            self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def body(self, limit, typ):
        require(self.headers.get_content_type() == typ, "İçerik türü geçersiz.")
        length = integer(self.headers.get("Content-Length"))
        if not 0 < length <= limit:
            raise Problem(413, "TOO_LARGE", "Dosya boyut sınırını aşıyor.")
        data = self.rfile.read(length)
        require(len(data) == length, "Yükleme yarıda kesildi.")
        return data

    def json_body(self, limit=MAX_JSON):
        try:

            def invalid(_):
                raise ValueError()

            value = json.loads(
                self.body(limit, "application/json").decode("utf-8"),
                parse_constant=invalid,
            )
            require(isinstance(value, dict), "JSON nesnesi bekleniyor.")
            return value
        except (ValueError, UnicodeError, RecursionError):
            raise Problem(400, "BAD_JSON", "JSON okunamadı.") from None

    def route(self, pieces, query):
        v = self.server.vault
        if self.command == "GET" and pieces == ["health"]:
            return {"service": "roleve-saha", "schema": 1}
        if self.command == "POST" and pieces == ["login"]:
            packet = self.json_body(8192)
            return v.login(
                packet.get("username"), packet.get("password"), self.client_address[0]
            )
        authorization = self.headers.get("Authorization", "")
        token = authorization[7:] if authorization.startswith("Bearer ") else ""
        actor = v.auth(token)
        if self.command == "POST" and pieces == ["logout"]:
            v.logout(token)
            return {"closed": True}
        if pieces == ["team"]:
            if self.command == "GET":
                return v.members(actor)
            if self.command == "POST":
                packet = self.json_body(8192)
                return {
                    "username": v.add_user(
                        packet.get("username"), packet.get("password"), manager=actor
                    )
                }
        if pieces == ["team", "work"] and self.command == "GET":
            return v.team_work(
                actor, query.get("q", [""])[0], integer(query.get("offset", ["0"])[0])
            )
        if (
            len(pieces) == 3
            and pieces[:2] == ["team", "members"]
            and self.command == "POST"
        ):
            packet = self.json_body(8192)
            return v.member_change(
                actor, pieces[2], packet.get("action"), packet.get("password")
            )
        if pieces == ["customers"] and self.command == "GET":
            return v.customers(actor)
        if len(pieces) == 2 and pieces[0] == "customers" and self.command == "PUT":
            return v.customer_put(actor, pieces[1], self.json_body(2048))
        if not pieces or pieces[0] != "projects":
            raise Problem(404, "NOT_FOUND", "Adres bulunamadı.")
        if len(pieces) == 1 and self.command == "GET":
            return v.listings(actor)
        if len(pieces) >= 2:
            pid = pieces[1]
            if len(pieces) == 2:
                if self.command == "GET":
                    return v.get(actor, pid)
                if self.command == "PUT":
                    return v.save(actor, pid, self.json_body())
            if pieces[2:] == ["share"] and self.command == "POST":
                packet = self.json_body(2048)
                return v.share(actor, pid, packet.get("username"), packet.get("role"))
            if pieces[2:] == ["head"] and self.command == "GET":
                return v.head(actor, pid)
            if pieces[2:] == ["versions"] and self.command == "GET":
                return v.history(actor, pid)
            if len(pieces) == 4 and self.command == "GET":
                if pieces[2] == "versions":
                    return v.get(actor, pid, integer(pieces[3]))
                if pieces[2] == "media":
                    return v.download(actor, pid, pieces[3])
                if pieces[2] == "uploads":
                    return v.upload_status(actor, pid, pieces[3])
            if len(pieces) == 5 and pieces[2] == "uploads" and self.command == "PUT":
                return v.chunk(
                    actor,
                    pid,
                    pieces[3],
                    integer(pieces[4]),
                    integer(query.get("size", [""])[0]),
                    self.body(CHUNK, "application/octet-stream"),
                )
        raise Problem(404, "NOT_FOUND", "Adres bulunamadı.")

    def static_file(self, path):
        if self.command not in ("GET", "HEAD") or not self.server.static:
            raise Problem(404, "NOT_FOUND", "Dosya bulunamadı.")
        parts = path.strip("/").split("/")
        if parts == [""]:
            parts = ["index.html"]
        if any(
            not part
            or part.startswith(".")
            or "\\" in part
            or part.lower()
            in ("server", "tests", "test", "evidence", "kanit", "node_modules")
            or "test" in Path(part).stem.lower()
            for part in parts
        ):
            raise Problem(404, "NOT_FOUND", "Dosya bulunamadı.")
        file = self.server.static.joinpath(*parts).resolve()
        allowed = {
            ".js",
            ".mjs",
            ".css",
            ".woff2",
            ".woff",
            ".ttf",
            ".svg",
            ".png",
            ".ico",
            ".jpeg",
            ".jpg",
            ".webp",
            ".webmanifest",
            ".wasm",
        }
        resolved_parts = (
            file.relative_to(self.server.static).parts
            if file.is_relative_to(self.server.static)
            else ()
        )
        if tuple(parts) != resolved_parts:
            raise Problem(404, "NOT_FOUND", "Dosya bulunamadı.")
        public = file.suffix.lower() in allowed or (
            len(parts) == 1
            and parts[0] in ("index.html", "manifest.json", "robots.txt")
        )
        if (
            not public
            or not file.is_relative_to(self.server.static)
            or not file.is_file()
            or file.stat().st_size > 24 * 1024**2
        ):
            raise Problem(404, "NOT_FOUND", "Dosya bulunamadı.")
        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if file.suffix in (".js", ".mjs"):
            mime = "text/javascript"
        if file.suffix == ".wasm":
            mime = "application/wasm"
        if file.suffix == ".webmanifest":
            mime = "application/manifest+json"
        self.send_body(200, file.read_bytes(), mime)

    def dispatch(self):
        cors = None
        try:
            url = urlsplit(self.path)
            path = unquote(url.path, errors="strict")
            if not path.startswith("/api/"):
                return self.static_file(path)
            cors = self.origin()
            if self.command == "OPTIONS":
                return self.send_body(204, b"", cors=cors)
            result = self.route(
                path[5:].strip("/").split("/"), parse_qs(url.query, max_num_fields=8)
            )
            if isinstance(result, bytes):
                return self.send_body(200, result, "application/octet-stream", cors)
            self.send_body(200, encode(result), cors=cors)
        except Problem as e:
            self.send_body(
                e.status, encode({"code": e.code, "message": str(e)}), cors=cors
            )
        except (TimeoutError, BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except (ValueError, UnicodeError, RecursionError):
            self.send_body(
                400,
                encode({"code": "INVALID", "message": "İstek okunamadı."}),
                cors=cors,
            )
        except sqlite3.Error:
            self.send_body(
                503,
                encode(
                    {
                        "code": "STORAGE",
                        "message": "Sunucu kaydı tamamlanamadı. Yeniden deneyin.",
                    }
                ),
                cors=cors,
            )
        except Exception:
            self.send_body(
                500,
                encode({"code": "SERVER", "message": "İşlem tamamlanamadı."}),
                cors=cors,
            )

    do_GET = do_POST = do_PUT = do_OPTIONS = do_HEAD = dispatch


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="Rölöve Saha özel sunucu")
    parser.add_argument("--db", type=Path, required=True, help="Özel SQLite yolu")
    actions = parser.add_subparsers(dest="action", required=True)
    serve = actions.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", default=8794, type=int)
    serve.add_argument("--allow-origin", action="append", default=[])
    serve.add_argument(
        "--static", type=Path, help="Yalnız yayınlanabilir ön yüz dizini"
    )
    add = actions.add_parser("user-add")
    add.add_argument("username")
    add.add_argument(
        "--admin", action="store_true", help="Kendi ekibini yönetebilen hesap oluştur"
    )
    backup = actions.add_parser("backup")
    backup.add_argument("target", type=Path)
    restore = actions.add_parser("restore", help="Yedeği yeni, boş bir veritabanına aç")
    restore.add_argument("source", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "restore":
            if args.db.exists() or not args.source.is_file():
                parser.error("Var olan yedek ve henüz var olmayan hedef seçin.")
            args.db.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            # The source remains read-only; no migration or user-session revival.
            fd = os.open(args.db, os.O_EXCL | os.O_CREAT | os.O_RDWR, 0o600)
            os.close(fd)
            try:
                with (
                    closing(
                        sqlite3.connect(
                            args.source.resolve().as_uri() + "?mode=ro", uri=True
                        )
                    ) as old,
                    closing(sqlite3.connect(args.db)) as new,
                    new,
                ):
                    if old.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise ValueError("Yedek doğrulanamadı.")
                    old.execute("SELECT project,rev,doc FROM versions LIMIT 0")
                    old.backup(new)
                    new.execute("DELETE FROM sessions")
                    new.execute("DELETE FROM staging")
                    new.execute("DELETE FROM login_limits")
            except BaseException:
                args.db.unlink(missing_ok=True)
                raise
            return 0
        vault = Vault(args.db)
        if args.action == "user-add":
            first = getpass.getpass("Yeni parola (en az 12 karakter): ")
            if first != getpass.getpass("Parolayı tekrarlayın: "):
                parser.error("Parolalar uyuşmuyor.")
            vault.add_user(args.username, first, admin=args.admin)
            print("Hesap açıldı.")
        elif args.action == "backup":
            vault.backup(args.target)
        elif args.action == "serve":
            if args.static and args.db.resolve().is_relative_to(args.static.resolve()):
                parser.error("Veritabanı ön yüz dizininin dışında olmalı.")
            for origin in args.allow_origin:
                url = urlsplit(origin)
                if (
                    url.path
                    or not url.netloc
                    or url.username
                    or url.password
                    or url.query
                    or url.fragment
                    or (
                        url.scheme != "https"
                        and not (
                            url.scheme == "http"
                            and url.hostname in ("localhost", "127.0.0.1", "::1")
                        )
                    )
                ):
                    parser.error("Tam ve güvenli bir ön yüz kökeni girin.")
            with Server(
                (args.host, args.port), vault, args.allow_origin, args.static
            ) as http:
                print(
                    f"Rölöve Saha HTTP API {args.host}:{http.server_port}", flush=True
                )
                http.serve_forever()
    except (ValueError, FileExistsError, Problem, sqlite3.Error) as exc:
        print("İşlem durdu: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
