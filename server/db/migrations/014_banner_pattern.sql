-- A pattern drawn over the profile banner (dots, lines, waves…) and its colour (NULL = a soft shade).
ALTER TABLE users ADD COLUMN banner_pattern TEXT;
ALTER TABLE users ADD COLUMN banner_pattern_color TEXT;
