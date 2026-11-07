CREATE TABLE "active_days" (
	"user_id" integer NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "active_days_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
ALTER TABLE "user_progress" ADD COLUMN "best_level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "active_days" ADD CONSTRAINT "active_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;