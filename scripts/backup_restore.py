#!/usr/bin/env python3
"""SQL backup proof and empty temporary D1 restore, using Python standard library.

Never logs diary text, tokens or signed export URLs. Remote proof only creates
and deletes databases created by that invocation. Restore refuses nonempty DBs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import time
from typing import Any, Iterable
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
SQL_LIMIT = 100_000
CHUNK_LIMIT = 48_000
TEMP_PREFIX = "kiroku-restore-check-"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def tables(connection: sqlite3.Connection) -> list[str]:
    return [r[0] for r in connection.execute(
        "SELECT name FROM sqlite_schema WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    )]


def digest_rows(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    # Keep only fixed-size row hashes, not an entire 500 MB diary table in RAM.
    hashes = sorted(sha(json.dumps(r, ensure_ascii=False, sort_keys=True,
                                  separators=(",", ":")).encode("utf-8")) for r in rows)
    return {"rows": len(hashes), "sha256": sha("\n".join(hashes).encode("ascii"))}


def snapshot(connection: sqlite3.Connection) -> dict[str, Any]:
    connection.row_factory = sqlite3.Row
    return {table: digest_rows(dict(r) for r in connection.execute(f"SELECT * FROM {q(table)}"))
            for table in tables(connection)}


def load_sql(path: Path) -> sqlite3.Connection:
    # Only use trusted SQL backups: SQL is executable input, not JSON import.
    connection = sqlite3.connect(":memory:")
    # read_text() would normalize CRLF inside SQL string literals on Windows.
    connection.executescript(path.read_bytes().decode("utf-8-sig"))
    if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("SQLite integrity check failed")
    return connection


def dump_sql(connection: sqlite3.Connection, path: Path) -> None:
    if path.exists():
        raise RuntimeError("Output already exists; use a new generation filename")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as output:
        for statement in connection.iterdump():
            output.write(statement + "\n")


def chunks(value: str):
    # Split on Unicode boundaries, keeping each bound value under 48 KB UTF-8.
    part: list[str] = []
    size = 0
    for char in value:
        char_size = len(char.encode("utf-8"))
        if size + char_size > CHUNK_LIMIT:
            yield "".join(part)
            part, size = [], 0
        part.append(char)
        size += char_size
    if part:
        yield "".join(part)


def fixture() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    migration_files = sorted((ROOT / "db" / "migrations").glob("*.sql"))
    if not migration_files:
        raise RuntimeError("No SQL migrations found")
    for migration in migration_files:
        connection.executescript(migration.read_text(encoding="utf-8-sig"))
    unit = "# 復元検証\r\n- [ ] 日本語・絵文字🍵 ' quote \\\n<script>保持</script>\n"
    body = unit * (1_000_000 // len(unit.encode("utf-8")))
    body += "x" * (1_000_000 - len(body.encode("utf-8")))
    stamp = "2026-10-18T00:00:00.000Z"
    for identity, date, text, version, deleted in [
        ("fixture-near-limit", "2026-10-18", body, 7, None),
        ("fixture-trash", "2026-10-17", "ゴミ箱\n- [x] 完了", 3, stamp),
        ("fixture-empty", "2026-10-16", "", 2, None),
    ]:
        connection.execute("INSERT INTO diaries VALUES (?, ?, ?, ?, ?, ?, ?)",
                           (identity, date, text, version, deleted, stamp, stamp))
    epoch = connection.execute("SELECT value FROM app_meta WHERE key='database_epoch'").fetchone()[0]
    for identity, title, text, pinned, archived, deleted in [
        ("fixture-note-limit", "メモの復元検証", body, 1, 0, None),
        ("fixture-note-archive", "しまったメモ", "- [x] 完了\r\n残しておく", 0, 1, None),
        ("fixture-note-trash", "メモのゴミ箱", "日本語🍵", 0, 0, stamp),
    ]:
        connection.execute("INSERT INTO notes (id,title,body,pinned,archived,excerpt,task_count,completed_count,version,deleted_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (identity, title, text, pinned, archived, title, 1, 0, 3, deleted, stamp, stamp))
        connection.execute("INSERT INTO note_mutation_receipts VALUES (?,?,?,?,?,?,?)",
                           (f"receipt-{identity}", "f" * 64, identity, "update", 3, epoch, stamp))
    connection.execute("INSERT INTO note_mutation_receipts VALUES (?,?,?,?,?,?,?)",
                       ("fixture-note-purge", "d" * 64, "fixture-note-purged", "purge", 3, epoch, stamp))
    for mutation, fingerprint, identity, date, kind, version in [
        ("fixture-create-near-limit", "a", "fixture-near-limit", "2026-10-18", "create", 1),
        ("fixture-operation", "f", "fixture-near-limit", "2026-10-18", "update", 7),
        ("fixture-trash-operation", "b", "fixture-trash", "2026-10-17", "trash", 3),
        ("fixture-old-create", "c", "fixture-purged", "2026-10-15", "create", 1),
        ("fixture-old-purge", "d", "fixture-purged", "2026-10-15", "purge", 3),
    ]:
        connection.execute("INSERT INTO mutation_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                           (mutation, fingerprint * 64, identity, date, kind, version, epoch, stamp))
    for identity in ["fixture-near-limit", "fixture-trash"]:
        for revision in [1, 2]:
            connection.execute("INSERT INTO summary_history VALUES (?, ?, ?, ?, ?, ?)",
                               (identity, revision, 7, epoch, f"架空の要約 {revision} 🍵", stamp))
        connection.execute("INSERT INTO diary_summaries VALUES (?, ?, ?, ?, ?, ?)",
                           (identity, 7, epoch, 2, "架空の要約 2 🍵", stamp))
    connection.execute("INSERT INTO summary_mutation_receipts VALUES (?, ?, ?, ?, ?, ?, ?)",
                       ("fixture-summary-operation", "e" * 64, "fixture-near-limit", 7, 2, epoch, stamp))
    connection.execute("INSERT INTO mcp_daily_usage VALUES (?, ?, ?, ?)", ("2026-10-20", 10, 2, 24000))
    connection.commit()
    return connection


class LocalD1:
    """SQLite stand-in exercising the same small-SQL transfer plan, not real D1."""
    def __init__(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.row_factory = sqlite3.Row
        self.max_sql_bytes = 0
        self.max_parameter_bytes = 0

    def query(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        params = params or []
        self.max_sql_bytes = max(self.max_sql_bytes, len(sql.encode("utf-8")))
        self.max_parameter_bytes = max([self.max_parameter_bytes] +
            [len(p.encode("utf-8")) for p in params if isinstance(p, str)])
        if self.max_sql_bytes > SQL_LIMIT or len(params) > 100:
            raise RuntimeError("D1 SQL/parameter count limit exceeded")
        cursor = self.connection.execute(sql, params)
        return [dict(r) for r in cursor.fetchall()] if cursor.description else []


class Cloudflare:
    def __init__(self, account: str):
        if not re.fullmatch(r"[a-fA-F0-9]{32}", account):
            raise RuntimeError("CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID")
        self.token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
        if not self.token:
            raise RuntimeError("CLOUDFLARE_API_TOKEN is required; never pass it as a CLI argument")
        self.base = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database"

    def request(self, method: str, suffix: str = "", payload: Any = None) -> Any:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(self.base + suffix, data=data, method=method,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            # API error bodies can contain submitted SQL/parameters: do not print them.
            raise RuntimeError(f"Cloudflare API HTTP {error.code}; response body omitted") from None
        except urllib.error.URLError:
            raise RuntimeError("Cloudflare API transport failure; no blind write retry") from None
        if result.get("success") is not True:
            codes = [e.get("code") for e in result.get("errors", [])]
            raise RuntimeError(f"Cloudflare API rejected request (codes={codes}); body omitted")
        return result.get("result")


class RemoteD1:
    def __init__(self, api: Cloudflare, identity: str):
        self.api, self.identity = api, identity

    def query(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        if len(sql.encode("utf-8")) > SQL_LIMIT or len(params or []) > 100:
            raise RuntimeError("D1 SQL/parameter count limit exceeded before sending")
        result = self.api.request("POST", f"/{self.identity}/query", {"sql": sql, "params": params or []})
        if not isinstance(result, list) or len(result) != 1 or result[0].get("success") is not True:
            raise RuntimeError("D1 statement failed; response body omitted")
        return result[0].get("results", [])


def transfer(source: sqlite3.Connection, target: Any) -> None:
    # Restore only into an empty target. No DROP, upsert, delete or overwrite.
    existing = target.query("SELECT name FROM sqlite_schema WHERE type='table' "
                            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
    if existing:
        raise RuntimeError("Restore target is not empty; refusing to overwrite")
    source.row_factory = sqlite3.Row
    table_names = tables(source)
    schema = source.execute("SELECT type, name, sql FROM sqlite_schema "
                            "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' "
                            "AND name NOT LIKE '_cf_%' ORDER BY type, name").fetchall()
    if any(row["type"] not in ("table", "index") for row in schema):
        raise RuntimeError("Restore supports this MVP's tables/indexes; review triggers/views manually")
    for item in schema:
        if item["type"] == "table":
            target.query(item["sql"])
    # Insert parents before children while keeping D1 foreign keys enforced.
    remaining = set(table_names)
    ordered: list[str] = []
    while remaining:
        ready = sorted(table for table in remaining if not {
            row["table"] for row in source.execute(f"PRAGMA foreign_key_list({q(table)})")
        }.intersection(remaining))
        if not ready:
            raise RuntimeError("Cyclic foreign keys require a reviewed restore plan")
        ordered.extend(ready)
        remaining.difference_update(ready)
    for table in ordered:
        info = source.execute(f"PRAGMA table_info({q(table)})").fetchall()
        primary = [r["name"] for r in sorted(info, key=lambda r: r["pk"]) if r["pk"]]
        columns = [r["name"] for r in info]
        for row in source.execute(f"SELECT * FROM {q(table)}"):
            values = [row[column] for column in columns]
            large = [i for i, value in enumerate(values)
                     if isinstance(value, str) and len(value.encode("utf-8")) > CHUNK_LIMIT]
            if any(isinstance(v, bytes) for v in values):
                raise RuntimeError("BLOB migration requires separate review")
            if large and not primary:
                raise RuntimeError("Large-text row requires primary key for safe chunk assembly")
            if any(columns[i] in primary for i in large):
                raise RuntimeError("Large primary key cannot be restored with chunk assembly")
            initial = ["" if i in large else value for i, value in enumerate(values)]
            target.query(f"INSERT INTO {q(table)} ({', '.join(q(c) for c in columns)}) "
                         f"VALUES ({', '.join('?' for _ in columns)})", initial)
            for index in large:
                column = q(columns[index])
                for chunk in chunks(values[index]):
                    target.query(f"UPDATE {q(table)} SET {column}={column} || ? WHERE " +
                                 " AND ".join(f"{q(key)}=?" for key in primary),
                                 [chunk] + [row[key] for key in primary])
    for item in schema:
        if item["type"] == "index":
            target.query(item["sql"])


def target_snapshot(source: sqlite3.Connection, target: Any) -> dict[str, Any]:
    # D1 responses must be bounded even when the database has hundreds of 1 MB days.
    source.row_factory = sqlite3.Row
    def rows(table: str):
        info = source.execute(f"PRAGMA table_info({q(table)})").fetchall()
        primary = [r["name"] for r in sorted(info, key=lambda r: r["pk"]) if r["pk"]]
        if not primary:
            raise RuntimeError("Snapshot verification requires an explicit primary key")
        last: list[Any] | None = None
        limit = 3 if table in ("diaries", "notes") else 100
        order = ", ".join(q(key) for key in primary)
        while True:
            where = f"WHERE ({order}) > ({', '.join('?' for _ in primary)})" if last is not None else ""
            page = target.query(f"SELECT * FROM {q(table)} {where} ORDER BY {order} LIMIT {limit}", last or [])
            yield from page
            if len(page) < limit:
                break
            last = [page[-1][key] for key in primary]
    return {table: digest_rows(rows(table)) for table in tables(source)}


def server_revision(target: Any) -> str:
    names = {row["name"] for row in target.query("SELECT name FROM sqlite_schema WHERE type='table'")}
    summary_revision = " || ':' || (SELECT COALESCE(MAX(rowid), 0) FROM summary_mutation_receipts)" if "summary_mutation_receipts" in names else ""
    note_revision = " || ':' || (SELECT COALESCE(MAX(rowid), 0) FROM note_mutation_receipts)" if "note_mutation_receipts" in names else ""
    rows = target.query("SELECT value || ':' || (SELECT COALESCE(MAX(rowid), 0) "
                        "FROM mutation_receipts)" + summary_revision + note_revision + " AS revision FROM app_meta WHERE key='database_epoch'")
    if not rows:
        raise RuntimeError("Database epoch missing; cannot verify export stability")
    return str(rows[0]["revision"])


def verify_indexes(source: sqlite3.Connection, target: Any) -> list[str]:
    sql = "SELECT name FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL ORDER BY name"
    expected = [row[0] for row in source.execute(sql)]
    actual = [row["name"] for row in target.query(sql)]
    if expected != actual:
        raise RuntimeError("Restored indexes differ from SQL backup")
    return expected


def verify_foreign_keys(target: Any) -> None:
    if target.query("PRAGMA foreign_key_check"):
        raise RuntimeError("Restored foreign keys are inconsistent")


def body_proof(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return [{"kind": table, "id": identity, "bytes": len(body.encode("utf-8")), "sha256": sha(body.encode("utf-8"))}
            for table in ("diaries", "notes") if table in tables(connection)
            for identity, body in connection.execute(f"SELECT id, body FROM {q(table)} ORDER BY id")]


def rotate_epoch(target: Any) -> str:
    epoch = str(uuid.uuid4())
    target.query("UPDATE app_meta SET value=? WHERE key='database_epoch'", [epoch])
    got = target.query("SELECT value FROM app_meta WHERE key='database_epoch'")
    if not got or got[0]["value"] != epoch:
        raise RuntimeError("Database epoch rotation verification failed")
    return epoch


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


def self_test(output: Path) -> None:
    original = fixture()
    with tempfile.TemporaryDirectory(prefix="kiroku-local-proof-") as directory:
        sql = Path(directory) / "backup.sql"
        dump_sql(original, sql)
        restored = load_sql(sql)
        if snapshot(original) != snapshot(restored):
            raise RuntimeError("SQL export/import table digest mismatch")
        mirror = LocalD1()
        transfer(restored, mirror)
        if snapshot(original) != target_snapshot(original, mirror):
            raise RuntimeError("Chunked parameterized restore table digest mismatch")
        indexes = verify_indexes(restored, mirror)
        verify_foreign_keys(mirror)
        previous_epoch = mirror.query("SELECT value FROM app_meta WHERE key='database_epoch'")[0]["value"]
        epoch = rotate_epoch(mirror)
        if epoch == previous_epoch:
            raise RuntimeError("Epoch did not change")
        try:
            transfer(restored, mirror)
        except RuntimeError as error:
            if "not empty" not in str(error):
                raise
        else:
            raise RuntimeError("Nonempty target was not refused")
        report = {"checkedAt": now(), "kind": "local-sqlite-only", "passed": True,
                  "sqlExportImportMatched": True, "chunkedParameterizedTransferMatched": True,
                  "epochRotated": True, "nonemptyTargetRefused": True, "maxSqlBytes": mirror.max_sql_bytes,
                  "metadataTablesMatched": ["app_meta", "mutation_receipts", "summary_mutation_receipts", "mcp_daily_usage"],
                  "tablesMatched": tables(original), "foreignKeysChecked": True, "indexesRestored": indexes,
                  "maxBoundStringBytes": mirror.max_parameter_bytes,
                  "sqlBackupBytes": sql.stat().st_size, "bodies": body_proof(original),
                  "migrationSha256": {path.name: sha(path.read_bytes())
                                      for path in sorted((ROOT / "db" / "migrations").glob("*.sql"))},
                  "remoteD1": "NOT RUN", "androidChrome": "NOT RUN", "cloudflareAccess": "NOT RUN"}
        write_report(output, report)


def export_remote(api: Cloudflare, identity: str, path: Path) -> None:
    if path.exists():
        raise RuntimeError("Export output exists")
    body: dict[str, Any] = {"output_format": "polling"}
    for _ in range(180):
        result = api.request("POST", f"/{identity}/export", body)
        if result.get("status") == "error" or result.get("success") is False:
            raise RuntimeError("D1 SQL export failed; response omitted")
        if result.get("status") == "complete":
            url = result.get("result", {}).get("signed_url", "")
            if urllib.parse.urlsplit(url).scheme != "https":
                raise RuntimeError("D1 export did not return an HTTPS download")
            # No API Authorization header is sent to the signed storage URL.
            try:
                with urllib.request.urlopen(url, timeout=60) as response, path.open("xb") as output:
                    while chunk := response.read(65_536):
                        output.write(chunk)
            except (urllib.error.URLError, urllib.error.HTTPError):
                raise RuntimeError("SQL export download failed; signed URL omitted") from None
            return
        bookmark = result.get("at_bookmark")
        if not isinstance(bookmark, str) or not bookmark:
            raise RuntimeError("D1 export polling returned no bookmark")
        body["current_bookmark"] = bookmark
        time.sleep(1)
    raise RuntimeError("D1 SQL export polling timed out")


def remote_proof(output: Path) -> None:
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    api = Cloudflare(account)
    report: dict[str, Any] = {"checkedAt": now(), "kind": "real-temporary-cloudflare-d1",
                              "passed": False, "temporaryDatabases": [], "cleanup": []}
    created: list[tuple[str, str]] = []
    failed: Exception | None = None
    try:
        listed = api.request("GET", "?per_page=100")
        if len(listed) > 8:
            raise RuntimeError("Need two free database slots; no paid setting will be enabled")
        original = fixture()
        for suffix in ("source", "target"):
            name = TEMP_PREFIX + uuid.uuid4().hex[:12] + "-" + suffix
            result = api.request("POST", payload={"name": name})
            identity = result.get("uuid", "")
            if not identity:
                raise RuntimeError("Create returned no database UUID; inspect Cloudflare dashboard")
            created.append((identity, name))
            report["temporaryDatabases"].append({"id": identity, "name": name})
        source = RemoteD1(api, created[0][0])
        transfer(original, source)
        if snapshot(original) != target_snapshot(original, source):
            raise RuntimeError("Source D1 fixture digest mismatch")
        with tempfile.TemporaryDirectory(prefix="kiroku-real-d1-proof-") as directory:
            sql = Path(directory) / "d1-export.sql"
            export_remote(api, source.identity, sql)
            exported = load_sql(sql)
            if snapshot(original) != snapshot(exported):
                raise RuntimeError("Real D1 SQL export digest mismatch")
            target = RemoteD1(api, created[1][0])
            transfer(exported, target)
            if snapshot(exported) != target_snapshot(exported, target):
                raise RuntimeError("Real D1 restored table digest mismatch")
            indexes = verify_indexes(exported, target)
            verify_foreign_keys(target)
            rotate_epoch(target)
            report.update({"passed": True, "sqlExportImportMatched": True,
                           "chunkedParameterizedTransferMatched": True, "epochRotated": True,
                           "metadataTablesMatched": ["app_meta", "mutation_receipts", "summary_mutation_receipts", "mcp_daily_usage"],
                           "tablesMatched": tables(exported), "foreignKeysChecked": True, "indexesRestored": indexes,
                           "bodies": body_proof(exported), "sqlBackupBytes": sql.stat().st_size})
    except Exception as error:
        failed = error
        report["failure"] = str(error) if type(error) is RuntimeError else type(error).__name__ + "; details omitted"
    finally:
        # Only UUIDs created by this invocation can enter this deletion loop.
        for identity, name in reversed(created):
            try:
                current = api.request("GET", f"/{identity}")
                if current.get("name") != name or not name.startswith(TEMP_PREFIX):
                    raise RuntimeError("Temporary database identity check failed; delete refused")
                api.request("DELETE", f"/{identity}")
                report["cleanup"].append({"id": identity, "deleted": True})
            except Exception:
                report["cleanup"].append({"id": identity, "deleted": False,
                    "action": "Inspect this temporary database in Cloudflare dashboard and remove manually"})
        if any(not item["deleted"] for item in report["cleanup"]):
            report["passed"] = False
        write_report(output, report)
    if failed or not report["passed"]:
        raise RuntimeError("Remote proof failed; see metadata-only report")


def validate_id(identity: str) -> str:
    try:
        return str(uuid.UUID(identity))
    except ValueError:
        raise RuntimeError("Database ID must be a UUID") from None


def restore_empty(args: Any) -> None:
    identity = validate_id(args.database_id)
    if validate_id(args.confirm_empty_database_id) != identity:
        raise RuntimeError("Confirmation database ID does not match")
    if not args.expected_name.startswith((TEMP_PREFIX, "kiroku-recovery-")):
        raise RuntimeError("Use a newly created kiroku-recovery- or kiroku-restore-check- database")
    source = load_sql(args.sql)
    api = Cloudflare(os.environ.get("CLOUDFLARE_ACCOUNT_ID", ""))
    metadata = api.request("GET", f"/{identity}")
    if metadata.get("name") != args.expected_name:
        raise RuntimeError("Remote database name does not match reviewed target")
    target = RemoteD1(api, identity)
    transfer(source, target)
    if snapshot(source) != target_snapshot(source, target):
        raise RuntimeError("Restored D1 content mismatch; do not route application to this database")
    indexes = verify_indexes(source, target)
    verify_foreign_keys(target)
    rotate_epoch(target)
    write_report(args.report, {"checkedAt": now(), "kind": "real-empty-cloudflare-d1-restore",
        "passed": True, "databaseId": identity, "databaseName": args.expected_name,
        "allTableDigestsMatchedBeforeEpochRotation": True, "epochRotated": True,
        "metadataTablesMatched": [name for name in ("app_meta", "mutation_receipts", "summary_mutation_receipts", "mcp_daily_usage") if name in tables(source)],
        "tablesMatched": tables(source), "foreignKeysChecked": True, "indexesRestored": indexes,
        "sqlSha256": sha(args.sql.read_bytes()), "bodies": body_proof(source),
        "applicationBindingChanged": False})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    local = commands.add_parser("self-test", help="Fake data, SQL roundtrip and transfer plan; no network")
    local.add_argument("--report", type=Path, default=ROOT / "docs" / "local-backup-proof.json")
    verify = commands.add_parser("verify-sql", help="Restore trusted SQL into empty in-memory SQLite and hash")
    verify.add_argument("--sql", type=Path, required=True)
    verify.add_argument("--report", type=Path, required=True)
    export = commands.add_parser("local-export", help="Read-only SQLite SQL export and roundtrip verification")
    export.add_argument("--database", type=Path, required=True)
    export.add_argument("--output", type=Path, required=True)
    remote = commands.add_parser("remote-proof", help="Create two fake-data temporary D1 DBs, export/restore/delete")
    remote.add_argument("--run-remote", action="store_true", required=True,
                        help="Explicitly execute temporary Cloudflare resource operations")
    remote.add_argument("--report", type=Path, default=ROOT / "docs" / "remote-backup-proof.json")
    remote_export = commands.add_parser("remote-export", help="Read-only D1 SQL export; blocks DB during export")
    remote_export.add_argument("--database-id", required=True)
    remote_export.add_argument("--output", type=Path, required=True)
    recovery = commands.add_parser("restore-empty-d1", help="Restore into a reviewed NEW empty recovery D1 only")
    recovery.add_argument("--sql", type=Path, required=True)
    recovery.add_argument("--database-id", required=True)
    recovery.add_argument("--confirm-empty-database-id", required=True)
    recovery.add_argument("--expected-name", required=True)
    recovery.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "self-test":
        self_test(args.report)
    elif args.command == "verify-sql":
        connection = load_sql(args.sql)
        write_report(args.report, {"checkedAt": now(), "kind": "local-sqlite-only", "passed": True,
            "sqlSha256": sha(args.sql.read_bytes()), "tables": snapshot(connection), "bodies": body_proof(connection),
            "remoteD1": "NOT RUN"})
    elif args.command == "local-export":
        path = args.database.resolve(strict=True)
        connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
        connection.execute("BEGIN")
        expected = snapshot(connection)
        dump_sql(connection, args.output)
        restored = load_sql(args.output)
        if expected != snapshot(restored):
            raise RuntimeError("Exported SQL failed byte-preserving roundtrip verification")
        write_report(args.output.with_suffix(".manifest.json"), {"checkedAt": now(), "kind": "local-sqlite-only",
            "passed": True, "sqlSha256": sha(args.output.read_bytes()), "tables": expected,
            "bodies": body_proof(restored), "remoteD1": "NOT RUN"})
    elif args.command == "remote-proof":
        remote_proof(args.report)
    elif args.command == "remote-export":
        identity = validate_id(args.database_id)
        api = Cloudflare(os.environ.get("CLOUDFLARE_ACCOUNT_ID", ""))
        source = RemoteD1(api, identity)
        revision_before = server_revision(source)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        export_remote(api, identity, args.output)
        restored = load_sql(args.output)
        expected = target_snapshot(restored, source)
        if revision_before != server_revision(source):
            raise RuntimeError("Database changed during backup verification; stop editing and export a new generation")
        if expected != snapshot(restored):
            raise RuntimeError("SQL export differs from live database; do not treat this SQL as a verified backup")
        write_report(args.output.with_suffix(".manifest.json"), {"checkedAt": now(),
            "kind": "real-cloudflare-d1-export-local-validation", "passed": True,
            "sqlSha256": sha(args.output.read_bytes()), "tables": expected, "liveSourceDigestsMatched": True,
            "bodies": body_proof(restored), "restoredIntoRemoteD1": False})
    else:
        restore_empty(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # sqlite3 errors may quote SQL/diary values: only custom RuntimeError text is safe.
        message = str(error) if type(error) is RuntimeError else type(error).__name__ + "; details omitted"
        print(message, file=sys.stderr)
        sys.exit(1)
