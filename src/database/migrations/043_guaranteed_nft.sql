-- Admin-granted NFT guarantee: while this flag is set, the player's next
-- defeated boss always drops an NFT. The flag is set by /nftgive and cleared
-- once it is consumed.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS guaranteed_nft BOOLEAN NOT NULL DEFAULT false;
