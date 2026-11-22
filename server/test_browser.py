"""Ephemeral real HTTP/IndexedDB integration. --atlas uses the verified existing Chrome."""

import argparse
import json
import secrets
import sys
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlsplit

from server import Handler, Server
from vault import Vault

HERE = Path(__file__).resolve().parent
STORE = HERE.parent / "storage"
DEVICES = {"device-a", "device-b", "device-c", "device-legacy", "device-v2"}
# Real modules exercised by the storage suite, including their public UI/geometry imports.
MODULES = {
    "storage": {"store.js", "local.js", "media.js", "merge.js", "actions.js"},
    "geometry": {"core.js", "measure.js"},
    "ui": {"dialog.js", "base.js", "sections.js"},
    "openings": {"drawing.js"},
    "photo": {"annotations.js"},
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--atlas", action="store_true", help="Yalnız zaten açık normal Chrome ile buluş"
    )
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args()
    key = secrets.token_urlsafe(24)
    password = secrets.token_urlsafe(32)
    completed = threading.Event()
    outcome = {}

    class TestHandler(Handler):
        def dispatch(self):
            path = urlsplit(self.path).path
            if path == "/" + key and self.command == "GET":
                config = json.dumps(dict(password=password))
                html = f"""<!doctype html><html lang="tr"><meta charset="utf-8"><title>Rölöve · Depolama testi</title>
                <body><dialog id="modal"></dialog><output id="toast"></output><p id="status">Sentetik saha kayıtları deneniyor…</p><script type="module">
                let result;try{{const {{run}}=await import('/{key}/suite.js');result=await run({config})}} catch(e){{result={{ok:false,error:String(e.message),line:String(e.stack||'').split('\\n').slice(1,4)}}}}
                await fetch('/{key}/result',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(result)}});
                document.querySelector('#status').textContent=result.ok?'Rölöve kayıt testleri geçti.':'Kontrol gerekli.';
                </script></body></html>"""
                return self.send_body(200, html.encode(), "text/html; charset=utf-8")
            if path == "/" + key + "/suite.js" and self.command == "GET":
                return self.send_body(
                    200,
                    (STORE / "tests" / "browser.js").read_bytes(),
                    "text/javascript",
                )
            if path == "/fixtures/original.avif" and self.command == "GET":
                return self.send_body(
                    200,
                    (HERE / "testdata" / "original.avif").read_bytes(),
                    "image/avif",
                )
            parts = path.strip("/").split("/")
            if (
                self.command == "GET"
                and len(parts) == 3
                and parts[0] in DEVICES
                and parts[2] in MODULES.get(parts[1], ())
            ):
                module = HERE.parent / parts[1] / parts[2]
                return self.send_body(200, module.read_bytes(), "text/javascript")
            if path == "/" + key + "/result" and self.command == "POST":
                data = self.json_body(8192)
                self.send_body(200, b"{}")
                outcome.update(data)
                completed.set()
                return
            super().dispatch()

        do_GET = do_POST = dispatch

    with tempfile.TemporaryDirectory() as tmp:
        vault = Vault(Path(tmp) / "test.sqlite")
        for name in ("yonetici", "yonetici2"):
            vault.add_user(name, password, admin=True)
        for name in ("mimar", "okuyucu"):
            vault.add_user(name, password)
        with Server(("127.0.0.1", 0), vault) as http:
            http.RequestHandlerClass = TestHandler
            runner = threading.Thread(target=http.serve_forever, daemon=True)
            runner.start()
            origin = "http://127.0.0.1:" + str(http.server_port)
            browser = None
            tabid = None
            try:
                if args.atlas:
                    helper = (
                        HERE.parents[5] / "_araclar" / "atlas-motor" / "mevcut-chrome"
                    )
                    sys.path.insert(0, str(helper))
                    import mevcut_chrome as chrome

                    source = chrome.MacProcessSource()
                    identity = chrome.select_process(source)
                    browser = chrome.ScriptingBridgeBrowser(identity, source)
                    tabs = browser.tabs()
                    tabid = browser.new_tab(tabs[0].window_id, origin + "/" + key)
                else:
                    print("Geçici sentetik test URL " + origin + "/" + key, flush=True)
                if not completed.wait(160):
                    raise RuntimeError("Tarayıcı test sonucu zaman aşımı.")
            finally:
                if tabid is not None and browser:
                    try:
                        tab = chrome.choose_tab(browser, tabid, origin)
                        if tab.url == origin + "/" + key:
                            tab.native.close()
                    except Exception:
                        pass
                http.shutdown()
                runner.join()
        if args.evidence:
            from datetime import datetime

            outcome.update(
                ureten="codex",
                at=datetime.now().astimezone().isoformat(),
                engine="mevcut Chrome / IndexedDB + loopback SQLite",
            )
            args.evidence.write_text(
                json.dumps(outcome, ensure_ascii=False, indent=2) + "\n"
            )
        print(json.dumps(outcome, ensure_ascii=False))
        return 0 if outcome.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
