CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`session_code` text NOT NULL,
	`stage` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
