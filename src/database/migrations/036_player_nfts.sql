-- Counter of the ultra-rare NFTs a player has caught for defeating bosses.
-- The NFT itself is granted manually by the administrators, so only the number
-- of caught NFTs is stored here.

ALTER TABLE player_progress
  ADD COLUMN IF NOT EXISTS nfts_caught INTEGER NOT NULL DEFAULT 0;
