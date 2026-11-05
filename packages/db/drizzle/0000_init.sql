CREATE TYPE "public"."anchor" AS ENUM('wake', 'breakfast', 'lunch', 'dinner', 'sleep');--> statement-breakpoint
CREATE TYPE "public"."draft_kind" AS ENUM('add', 'change');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('open', 'confirmed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."frequency_type" AS ENUM('daily', 'every_n_days', 'weekdays', 'once');--> statement-breakpoint
CREATE TYPE "public"."intake_status" AS ENUM('pending', 'taken', 'snoozed', 'skipped', 'not_marked');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."xp_event_kind" AS ENUM('intake', 'day_complete');--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_feedback_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"input_text" text,
	"model_output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"kind" "draft_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "draft_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intakes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "intakes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"medication_id" integer NOT NULL,
	"schedule_id" integer,
	"slot_id" integer,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "intake_status" DEFAULT 'pending' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"reminder_message_id" integer,
	"reminder_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intakes_slot_scheduled_at_uq" UNIQUE("slot_id","scheduled_at")
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "medications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"dose_amount" numeric,
	"dose_unit" text,
	"units_per_intake" numeric NOT NULL,
	"unit_form" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_slots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schedule_slots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"schedule_id" integer NOT NULL,
	"time" time,
	"anchor" "anchor",
	"anchor_offset_min" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "schedule_slots_time_xor_anchor" CHECK (("schedule_slots"."time" is null) <> ("schedule_slots"."anchor" is null))
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"medication_id" integer NOT NULL,
	"frequency_type" "frequency_type" NOT NULL,
	"every_n_days" smallint,
	"weekdays" smallint[],
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "schedule_status" DEFAULT 'active' NOT NULL,
	"paused_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_every_n_days_valid" CHECK (("schedules"."frequency_type" = 'every_n_days') = coalesce("schedules"."every_n_days" >= 2, false)),
	CONSTRAINT "schedules_weekdays_valid" CHECK (("schedules"."frequency_type" = 'weekdays') = coalesce(cardinality("schedules"."weekdays") > 0, false)),
	CONSTRAINT "schedules_end_after_start" CHECK ("schedules"."end_date" is null or "schedules"."end_date" >= "schedules"."start_date")
);
--> statement-breakpoint
CREATE TABLE "unlocks" (
	"user_id" integer NOT NULL,
	"item_key" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"equipped" boolean DEFAULT false NOT NULL,
	CONSTRAINT "unlocks_user_id_item_key_pk" PRIMARY KEY("user_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "user_progress" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"xp_total" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"days_with_ovi" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"wake" time DEFAULT '08:00' NOT NULL,
	"breakfast" time DEFAULT '09:00' NOT NULL,
	"lunch" time DEFAULT '13:00' NOT NULL,
	"dinner" time DEFAULT '19:00' NOT NULL,
	"sleep" time DEFAULT '23:00' NOT NULL,
	"repeat_count" smallint DEFAULT 1 NOT NULL,
	"repeat_delay_min" smallint DEFAULT 30 NOT NULL,
	CONSTRAINT "user_settings_repeat_count_range" CHECK ("user_settings"."repeat_count" between 0 and 2),
	CONSTRAINT "user_settings_repeat_delay_positive" CHECK ("user_settings"."repeat_delay_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"telegram_id" bigint NOT NULL,
	"first_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consent_at" timestamp with time zone,
	"onboarding_step" text,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "xp_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"kind" "xp_event_kind" NOT NULL,
	"intake_id" integer,
	"date" date,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_events_kind_fields" CHECK (("xp_events"."kind" = 'intake' and "xp_events"."intake_id" is not null and "xp_events"."date" is null) or ("xp_events"."kind" = 'day_complete' and "xp_events"."date" is not null and "xp_events"."intake_id" is null)),
	CONSTRAINT "xp_events_amount_positive" CHECK ("xp_events"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_slot_id_schedule_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."schedule_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlocks" ADD CONSTRAINT "unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_feedback_user_id_idx" ON "ai_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drafts_user_status_idx" ON "drafts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "intakes_user_scheduled_at_idx" ON "intakes" USING btree ("user_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "intakes_reminder_group_id_idx" ON "intakes" USING btree ("reminder_group_id");--> statement-breakpoint
CREATE INDEX "medications_user_id_idx" ON "medications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "schedule_slots_schedule_id_idx" ON "schedule_slots" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedules_medication_id_idx" ON "schedules" USING btree ("medication_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_events_intake_uq" ON "xp_events" USING btree ("intake_id") WHERE "xp_events"."kind" = 'intake';--> statement-breakpoint
CREATE UNIQUE INDEX "xp_events_day_complete_uq" ON "xp_events" USING btree ("user_id","date") WHERE "xp_events"."kind" = 'day_complete';