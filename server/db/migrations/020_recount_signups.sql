-- Failed sign-up attempts used to count against an address's allowance. Start the windows over so nobody stays
-- blocked by attempts that never made an account.
DELETE FROM rate_windows WHERE key LIKE 'signupPerIp:%' OR key LIKE 'signupGlobal:%';
