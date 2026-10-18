CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `diaries` (
	`id` text PRIMARY KEY NOT NULL,
	`diary_date` text NOT NULL,
	`body` text NOT NULL,
	`version` integer NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "diaries_version_positive" CHECK("diaries"."version" >= 1),
	CONSTRAINT "diaries_body_bytes" CHECK(length(CAST("diaries"."body" AS BLOB)) <= 1000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diaries_diary_date_unique` ON `diaries` (`diary_date`);--> statement-breakpoint
CREATE INDEX `diaries_deleted_date_idx` ON `diaries` (`deleted_at`,`diary_date`);--> statement-breakpoint
CREATE TABLE `mutation_receipts` (
	`mutation_id` text PRIMARY KEY NOT NULL,
	`request_hash` text NOT NULL,
	`diary_id` text NOT NULL,
	`diary_date` text NOT NULL,
	`kind` text NOT NULL,
	`result_version` integer NOT NULL,
	`epoch` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "mutation_receipts_kind" CHECK("mutation_receipts"."kind" IN ('create', 'update', 'trash', 'restore', 'purge'))
);
--> statement-breakpoint
INSERT INTO app_meta (key, value) VALUES ('database_epoch', lower(hex(randomblob(16))));
