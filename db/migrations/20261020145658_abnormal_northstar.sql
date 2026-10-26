CREATE TABLE `diary_summaries` (
	`diary_id` text PRIMARY KEY NOT NULL,
	`source_version` integer NOT NULL,
	`source_epoch` text NOT NULL,
	`revision` integer NOT NULL,
	`summary` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`diary_id`) REFERENCES `diaries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "summary_revision_positive" CHECK("diary_summaries"."revision" >= 1),
	CONSTRAINT "summary_bytes" CHECK(length(CAST("diary_summaries"."summary" AS BLOB)) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE `mcp_daily_usage` (
	`day` text PRIMARY KEY NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`searches` integer DEFAULT 0 NOT NULL,
	`read_characters` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `summary_history` (
	`diary_id` text NOT NULL,
	`revision` integer NOT NULL,
	`source_version` integer NOT NULL,
	`source_epoch` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`diary_id`, `revision`),
	FOREIGN KEY (`diary_id`) REFERENCES `diaries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "summary_history_bytes" CHECK(length(CAST("summary_history"."summary" AS BLOB)) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE `summary_mutation_receipts` (
	`mutation_id` text PRIMARY KEY NOT NULL,
	`request_hash` text NOT NULL,
	`diary_id` text NOT NULL,
	`source_version` integer NOT NULL,
	`result_revision` integer NOT NULL,
	`epoch` text NOT NULL,
	`created_at` text NOT NULL
);
