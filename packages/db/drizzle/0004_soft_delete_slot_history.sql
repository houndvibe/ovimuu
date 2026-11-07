ALTER TABLE "intakes" DROP CONSTRAINT "intakes_slot_id_schedule_slots_id_fk";
--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_slot_id_schedule_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."schedule_slots"("id") ON DELETE set null ON UPDATE no action;