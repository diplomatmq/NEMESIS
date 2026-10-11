-- Migration 020: Buff vampire base attack by +3

BEGIN;

UPDATE classes 
SET base_attack = 13 
WHERE code = 'vampire';

COMMIT;
