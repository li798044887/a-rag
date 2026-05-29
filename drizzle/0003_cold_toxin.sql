ALTER TABLE "citations" ADD COLUMN "block_type" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "citations" ADD COLUMN "page" integer DEFAULT 0 NOT NULL;