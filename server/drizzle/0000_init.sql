CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"fund_id" text NOT NULL,
	"public_ref" text NOT NULL,
	"access_token_hash" text NOT NULL,
	"status" text DEFAULT 'intake' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"applicant_name" text,
	"applicant_email" text,
	"applicant_phone" text,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"category" text,
	"amount_requested_cents" integer,
	"amount_recommended_cents" integer,
	"amount_approved_cents" integer,
	"need_summary" text,
	"ready_to_submit" boolean DEFAULT false NOT NULL,
	"assessment" jsonb,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_recommendation" text,
	"ai_confidence" real,
	"ai_status" text DEFAULT 'idle' NOT NULL,
	"payout_method" text,
	"payout_receiver" text,
	"payout_verified" boolean DEFAULT false NOT NULL,
	"paypal_payer_id" text,
	"paypal_email" text,
	"paypal_name" text,
	"consent_public_story" boolean DEFAULT false NOT NULL,
	"public_story" text,
	"decision_note" text,
	"client_fingerprint" text,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_public_ref_unique" UNIQUE("public_ref")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"fund_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"extraction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" text PRIMARY KEY NOT NULL,
	"fund_id" text NOT NULL,
	"application_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"donor_name" text,
	"donor_email" text,
	"donor_message" text,
	"anonymous" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"agent_name" text,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"fee_cents" integer,
	"net_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_at" timestamp with time zone,
	CONSTRAINT "donations_paypal_order_id_unique" UNIQUE("paypal_order_id")
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text NOT NULL,
	"description" text NOT NULL,
	"region" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"policy_text" text NOT NULL,
	"rubric" jsonb NOT NULL,
	"max_grant_cents" integer NOT NULL,
	"auto_approve_limit_cents" integer DEFAULT 0 NOT NULL,
	"approvals_required" integer DEFAULT 1 NOT NULL,
	"dual_approval_above_cents" integer DEFAULT 50000 NOT NULL,
	"cooldown_days" integer DEFAULT 180 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"accent_color" text DEFAULT '#0E7C66' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funds_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"fund_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"fund_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sender_batch_id" text NOT NULL,
	"method" text NOT NULL,
	"receiver" text NOT NULL,
	"paypal_batch_id" text,
	"paypal_item_id" text,
	"paypal_transaction_id" text,
	"paypal_transaction_status" text,
	"fee_cents" integer,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	CONSTRAINT "payouts_sender_batch_id_unique" UNIQUE("sender_batch_id")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"reviewer_id" text,
	"reviewer_name" text NOT NULL,
	"decision" text NOT NULL,
	"amount_cents" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"verified" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_fund_status_idx" ON "applications" USING btree ("fund_id","status");--> statement-breakpoint
CREATE INDEX "applications_payer_idx" ON "applications" USING btree ("paypal_payer_id");--> statement-breakpoint
CREATE INDEX "applications_receiver_idx" ON "applications" USING btree ("payout_receiver");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "copilot_user_idx" ON "copilot_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_application_idx" ON "documents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "documents_sha_idx" ON "documents" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "donations_fund_idx" ON "donations" USING btree ("fund_id","status");--> statement-breakpoint
CREATE INDEX "ledger_fund_idx" ON "ledger_entries" USING btree ("fund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_ref_kind_idx" ON "ledger_entries" USING btree ("kind","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "messages_application_idx" ON "messages" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payouts_application_idx" ON "payouts" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "reviews_application_idx" ON "reviews" USING btree ("application_id");