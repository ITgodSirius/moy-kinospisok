CREATE TABLE `marks` (
	`owner` text NOT NULL,
	`card` text NOT NULL,
	`kind` text NOT NULL,
	`marked` integer NOT NULL,
	PRIMARY KEY(`owner`, `card`, `kind`)
);
