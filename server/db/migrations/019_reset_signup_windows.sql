-- The per-address sign-up window changed from a day to 10 minutes. Drop the old windows so an address
-- that signed up under the old rule isn't still blocked by a stale 24-hour reset.
DELETE FROM rate_windows WHERE key LIKE 'signupPerIp:%';