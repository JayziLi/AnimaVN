CREATE TABLE api_connections (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	api_type VARCHAR(32) NOT NULL, 
	base_url VARCHAR(500), 
	api_key VARCHAR(500), 
	model VARCHAR(200) NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at DATETIME NOT NULL, cached_models TEXT NOT NULL DEFAULT '[]', cached_models_at DATETIME, stream BOOLEAN NOT NULL DEFAULT 1, thinking VARCHAR(16), 
	PRIMARY KEY (id)
);

CREATE TABLE app_settings (
	"key" VARCHAR(64) NOT NULL, 
	value JSON, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY ("key")
);

CREATE TABLE card_scene_packs (
	card_id VARCHAR(32) NOT NULL, 
	pack_id VARCHAR(32) NOT NULL, 
	PRIMARY KEY (card_id), 
	FOREIGN KEY(card_id) REFERENCES tavern_cards (id), 
	FOREIGN KEY(pack_id) REFERENCES scene_packs (id)
);

CREATE TABLE card_sprite_layouts (
	card_id VARCHAR(32) NOT NULL, 
	auto BOOLEAN NOT NULL, 
	zoom FLOAT NOT NULL, 
	dx FLOAT NOT NULL, 
	dy FLOAT NOT NULL, 
	PRIMARY KEY (card_id), 
	FOREIGN KEY(card_id) REFERENCES tavern_cards (id)
);

CREATE TABLE card_sprites (
	id VARCHAR(32) NOT NULL, 
	card_id VARCHAR(32) NOT NULL, 
	label VARCHAR(80) NOT NULL, 
	aliases JSON NOT NULL, 
	description TEXT NOT NULL, 
	image BLOB, 
	mime VARCHAR(40), 
	sort INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, enabled BOOLEAN NOT NULL DEFAULT 1, face_scan JSON, 
	PRIMARY KEY (id), 
	FOREIGN KEY(card_id) REFERENCES tavern_cards (id)
);

CREATE TABLE card_voices (
	card_id VARCHAR(32) NOT NULL, 
	profile_id VARCHAR(32) NOT NULL, 
	is_main BOOLEAN NOT NULL, 
	PRIMARY KEY (card_id, profile_id), 
	FOREIGN KEY(card_id) REFERENCES tavern_cards (id), 
	FOREIGN KEY(profile_id) REFERENCES voice_profiles (id)
);

CREATE TABLE characters (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	tagline VARCHAR(200) NOT NULL, 
	description VARCHAR(300) NOT NULL, 
	persona TEXT NOT NULL, 
	world_setting TEXT NOT NULL, 
	greeting TEXT NOT NULL, 
	sprites JSON NOT NULL, 
	backgrounds JSON NOT NULL, 
	voice_id VARCHAR(120), 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE debug_chat_messages (
	id VARCHAR(36) NOT NULL, 
	chat_id VARCHAR(32) NOT NULL, 
	idx INTEGER NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	swipes JSON NOT NULL, 
	swipe_id INTEGER NOT NULL, 
	swipe_info JSON NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(chat_id) REFERENCES debug_chats (id)
);

CREATE TABLE debug_chats (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	card_id VARCHAR(32), 
	preset_id VARCHAR(32), 
	card_name VARCHAR(200) NOT NULL, 
	preset_name VARCHAR(200) NOT NULL, 
	user_name VARCHAR(120) NOT NULL, 
	tainted BOOLEAN NOT NULL, 
	parent_chat_id VARCHAR(32), 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, parent_message_id VARCHAR(36), 
	PRIMARY KEY (id), 
	FOREIGN KEY(card_id) REFERENCES tavern_cards (id), 
	FOREIGN KEY(preset_id) REFERENCES prompt_presets (id)
);

CREATE TABLE debug_snapshots (
	hash VARCHAR(16) NOT NULL, 
	payload JSON NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (hash)
);

CREATE TABLE game_sessions (
	id VARCHAR(32) NOT NULL, 
	character_id VARCHAR(32) NOT NULL, 
	slot_name VARCHAR(120) NOT NULL, 
	is_autosave BOOLEAN NOT NULL, 
	current_expression VARCHAR(120), 
	current_background VARCHAR(120), 
	current_bgm VARCHAR(120), 
	summary TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, slot_index INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(character_id) REFERENCES characters (id)
);

CREATE TABLE messages (
	id VARCHAR(32) NOT NULL, 
	session_id VARCHAR(32) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	content TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(session_id) REFERENCES game_sessions (id)
);

CREATE TABLE personas (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	description TEXT NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at DATETIME NOT NULL, avatar TEXT, 
	PRIMARY KEY (id)
);

CREATE TABLE prompt_presets (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	prompts JSON NOT NULL, 
	prompt_order JSON NOT NULL, 
	formats JSON NOT NULL, 
	params JSON NOT NULL, 
	squash_system_messages BOOLEAN NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE scene_assets (
	id VARCHAR(32) NOT NULL, 
	pack_id VARCHAR(32) NOT NULL, 
	kind VARCHAR(8) NOT NULL, 
	label VARCHAR(80) NOT NULL, 
	aliases JSON NOT NULL, 
	description TEXT NOT NULL, 
	data BLOB, 
	mime VARCHAR(40), 
	size INTEGER NOT NULL, 
	sort INTEGER NOT NULL, 
	focus_x INTEGER NOT NULL, 
	bgm_id VARCHAR(32), 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, enabled BOOLEAN NOT NULL DEFAULT 1, 
	PRIMARY KEY (id), 
	FOREIGN KEY(pack_id) REFERENCES scene_packs (id)
);

CREATE TABLE scene_packs (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	description TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, title_bgm_id VARCHAR(32), 
	PRIMARY KEY (id)
);

CREATE TABLE tavern_cards (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	description TEXT NOT NULL, 
	personality TEXT NOT NULL, 
	scenario TEXT NOT NULL, 
	first_mes TEXT NOT NULL, 
	mes_example TEXT NOT NULL, 
	system_prompt TEXT NOT NULL, 
	post_history_instructions TEXT NOT NULL, 
	creator_notes TEXT NOT NULL, 
	alternate_greetings JSON NOT NULL, 
	tags JSON NOT NULL, 
	creator VARCHAR(200) NOT NULL, 
	character_version VARCHAR(60) NOT NULL, 
	character_book JSON, 
	extensions JSON NOT NULL, 
	spec VARCHAR(40) NOT NULL, 
	avatar TEXT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, last_chat_id VARCHAR(32), 
	PRIMARY KEY (id)
);

CREATE TABLE tts_cache (
	"key" VARCHAR(64) NOT NULL, 
	data BLOB NOT NULL, 
	mime VARCHAR(40) NOT NULL, 
	size INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	last_used_at DATETIME NOT NULL, 
	PRIMARY KEY ("key")
);

CREATE TABLE tts_connections (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	api_type VARCHAR(32) NOT NULL, 
	base_url VARCHAR(500) NOT NULL, 
	sample_steps INTEGER NOT NULL, 
	options JSON NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE voice_emotions (
	id VARCHAR(32) NOT NULL, 
	profile_id VARCHAR(32) NOT NULL, 
	label VARCHAR(80) NOT NULL, 
	aliases JSON NOT NULL, 
	ref_path VARCHAR(500) NOT NULL, 
	prompt_text TEXT NOT NULL, 
	sort INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, emo_vector JSON, 
	PRIMARY KEY (id), 
	FOREIGN KEY(profile_id) REFERENCES voice_profiles (id)
);

CREATE TABLE voice_profiles (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(80) NOT NULL, 
	aliases JSON NOT NULL, 
	connection_id VARCHAR(32) NOT NULL, 
	gpt_weights VARCHAR(500) NOT NULL, 
	sovits_weights VARCHAR(500) NOT NULL, 
	text_lang VARCHAR(12) NOT NULL, 
	speed FLOAT NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, ref_path VARCHAR(500) NOT NULL DEFAULT '', params JSON NOT NULL DEFAULT '{}', 
	PRIMARY KEY (id), 
	FOREIGN KEY(connection_id) REFERENCES tts_connections (id)
);

CREATE INDEX ix_card_scene_packs_pack_id ON card_scene_packs (pack_id);

CREATE INDEX ix_card_sprites_card_id ON card_sprites (card_id);

CREATE INDEX ix_card_voices_profile_id ON card_voices (profile_id);

CREATE INDEX ix_debug_chat_messages_chat_id ON debug_chat_messages (chat_id);

CREATE INDEX ix_debug_chats_card_id ON debug_chats (card_id);

CREATE INDEX ix_scene_assets_pack_id ON scene_assets (pack_id);

CREATE INDEX ix_tts_cache_last_used_at ON tts_cache (last_used_at);

CREATE INDEX ix_voice_emotions_profile_id ON voice_emotions (profile_id);

CREATE INDEX ix_voice_profiles_connection_id ON voice_profiles (connection_id);

