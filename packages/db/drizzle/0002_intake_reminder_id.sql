ALTER TABLE "intakes" ADD COLUMN "reminder_id" integer;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intakes_reminder_id_idx" ON "intakes" USING btree ("reminder_id");