"""Estimate one-year storage using synthetic, in-memory SQLite data only.

Uses the current migrations plus a hypothetical single daily summary.
Does not measure Cloudflare CPU, D1 quota usage, or production database size.
"""

from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid


ROOT = Path(__file__).resolve().parent.parent
DAYS = 365
BODY_BYTES = 20_000
SUMMARY_BYTES = 2_000


def synthetic_text(byte_count: int) -> str:
    return "あ" * (byte_count // 3) + "x" * (byte_count % 3)


def allocated_bytes(connection: sqlite3.Connection) -> int:
    page_count = connection.execute("PRAGMA page_count").fetchone()[0]
    page_size = connection.execute("PRAGMA page_size").fetchone()[0]
    return page_count * page_size


def main() -> None:
    with sqlite3.connect(":memory:") as connection:
        for migration in sorted((ROOT / "db" / "migrations").glob("*.sql")):
            connection.executescript(migration.read_text(encoding="utf-8"))
        connection.execute(
            "CREATE TABLE experimental_capacity_summaries ("
            "diary_id TEXT PRIMARY KEY, source_version INTEGER NOT NULL, "
            "source_epoch TEXT NOT NULL, summary TEXT NOT NULL, "
            "generated_at TEXT NOT NULL, revision INTEGER NOT NULL)"
        )
        epoch = str(uuid.uuid4())
        connection.execute(
            "UPDATE app_meta SET value = ? WHERE key = 'database_epoch'", (epoch,)
        )
        days = [
            ((date(2080, 1, 1) + timedelta(days=index)).isoformat(), str(uuid.uuid4()))
            for index in range(DAYS)
        ]
        for diary_date, diary_id in days:
            timestamp = f"{diary_date}T12:00:00.000Z"
            connection.execute(
                "INSERT INTO diaries VALUES (?, ?, ?, 1, NULL, ?, ?)",
                (diary_id, diary_date, synthetic_text(BODY_BYTES), timestamp, timestamp),
            )
            connection.execute(
                "INSERT INTO experimental_capacity_summaries VALUES (?, 1, ?, ?, ?, 1)",
                (diary_id, epoch, synthetic_text(SUMMARY_BYTES), timestamp),
            )
        connection.commit()
        baseline = allocated_bytes(connection)
        scenarios = []
        inserted = 0
        for saves_per_day in (100, 500, 1000):
            target = DAYS * saves_per_day

            def receipts():
                for index in range(inserted, target):
                    diary_date, diary_id = days[index % DAYS]
                    yield (
                        str(uuid.uuid4()),
                        hashlib.sha256(str(index).encode()).hexdigest(),
                        diary_id,
                        diary_date,
                        "update",
                        index // DAYS + 1,
                        epoch,
                        f"{diary_date}T12:00:00.000Z",
                    )

            connection.executemany(
                "INSERT INTO mutation_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                receipts(),
            )
            connection.commit()
            inserted = target
            size = allocated_bytes(connection)
            scenarios.append(
                {
                    "successful_body_saves_per_day": saves_per_day,
                    "receipt_count": target,
                    "allocated_bytes": size,
                    "allocated_decimal_mb": round(size / 1_000_000, 2),
                    "receipt_and_index_growth_bytes": size - baseline,
                    "receipt_and_index_growth_decimal_mb": round(
                        (size - baseline) / 1_000_000, 2
                    ),
                }
            )
        report = {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "runtime": f"local in-memory SQLite {sqlite3.sqlite_version}",
            "scope": "Synthetic storage allocation estimate, not live D1 or CPU/quota validation",
            "days": DAYS,
            "body_utf8_bytes_per_day": BODY_BYTES,
            "summary_utf8_bytes_per_day": SUMMARY_BYTES,
            "summary_versions_per_day": 1,
            "fts_index": False,
            "baseline_allocated_bytes_without_receipts": baseline,
            "scenarios": scenarios,
        }
    output = ROOT / "test-results" / "mcp-capacity.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
