CREATE TABLE "reminders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reminders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"message_id" integer,
	"sent_at" timestamp with time zone,
	"repeats_sent" smallint DEFAULT 0 NOT NULL,
	"repeat_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "intakes_reminder_group_id_idx";--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_repeat_at_idx" ON "reminders" USING btree ("repeat_at");--> statement-breakpoint
CREATE INDEX "reminders_snoozed_until_idx" ON "reminders" USING btree ("snoozed_until");--> statement-breakpoint
ALTER TABLE "intakes" DROP COLUMN "reminder_message_id";--> statement-breakpoint
ALTER TABLE "intakes" DROP COLUMN "reminder_group_id";