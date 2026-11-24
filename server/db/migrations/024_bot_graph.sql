-- The node editor's layout (nodes, wires, positions). The program the server runs is still `program`,
-- built from these nodes by the editor.
ALTER TABLE bots ADD COLUMN graph TEXT;
