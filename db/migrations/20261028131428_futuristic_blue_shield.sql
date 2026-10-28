CREATE TABLE `note_mutation_receipts` (
	`mutation_id` text PRIMARY KEY NOT NULL,
	`request_hash` text NOT NULL,
	`note_id` text NOT NULL,
	`kind` text NOT NULL,
	`result_version` integer NOT NULL,
	`epoch` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "note_receipts_kind" CHECK("note_mutation_receipts"."kind" IN ('create', 'update', 'trash', 'restore', 'purge'))
);
--> statement-breakpoint
CREATE INDEX `note_receipts_note_idx` ON `note_mutation_receipts` (`note_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`excerpt` text NOT NULL,
	`task_count` integer DEFAULT 0 NOT NULL,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`version` integer NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "notes_version_positive" CHECK("notes"."version" >= 1),
	CONSTRAINT "notes_body_bytes" CHECK(length(CAST("notes"."body" AS BLOB)) <= 1000000),
	CONSTRAINT "notes_title_length" CHECK(length("notes"."title") <= 200),
	CONSTRAINT "notes_flags" CHECK("notes"."pinned" IN (0, 1) AND "notes"."archived" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `notes_list_idx` ON `notes` (`deleted_at`,`archived`,`pinned`,`updated_at`,`id`);