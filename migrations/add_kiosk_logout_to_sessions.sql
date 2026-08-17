-- Add kiosk logout fields to rental_sessions for remote pause/resume functionality
ALTER TABLE rental_sessions ADD COLUMN kiosk_logout_at DATETIME;
ALTER TABLE rental_sessions ADD COLUMN paused_remaining_seconds INTEGER;
ALTER TABLE rental_sessions ADD COLUMN kiosk_logout_reason TEXT;
