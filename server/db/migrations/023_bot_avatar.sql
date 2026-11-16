-- Bots built in the bot builder get the robot picture instead of a random built-in one (pictures someone
-- uploaded for a bot are kept).
UPDATE users SET avatar = '@default/bot'
WHERE id IN (SELECT user_id FROM bots) AND (avatar IS NULL OR avatar LIKE '@default/%');
