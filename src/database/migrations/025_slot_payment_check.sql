-- Add payment verification to slot sessions
-- Users must pay before they can use the session

ALTER TABLE slot_sessions 
ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE;

-- Update existing sessions to be paid (for backwards compatibility)
UPDATE slot_sessions 
SET is_paid = TRUE 
WHERE status != 'expired';
