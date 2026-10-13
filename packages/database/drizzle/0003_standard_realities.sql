-- Both ingestion paths are always available: real world 0 and simulation 1.
INSERT INTO core.reality(reality_id,name) VALUES (1,'Simulation') ON CONFLICT(reality_id) DO NOTHING;
