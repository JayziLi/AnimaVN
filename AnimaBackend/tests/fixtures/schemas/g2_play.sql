CREATE TABLE api_connections (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	api_type VARCHAR(32) NOT NULL, 
	base_url VARCHAR(500), 
	api_key VARCHAR(500), 
	model VARCHAR(200) NOT NULL, 
	cached_models JSON NOT NULL, 
	cached_models_at DATETIME, 
	is_active BOOLEAN NOT NULL, 
	stream BOOLEAN NOT NULL, 
	thinking VARCHAR(16), 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE app_settings (
	"key" VARCHAR(64) NOT NULL, 
	value JSON, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY ("key")
);

CREATE TABLE ban_records (
	user_id VARCHAR(32) NOT NULL, 
	reason TEXT NOT NULL, 
	"by" VARCHAR(8) NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE card_scene_packs (
	card_id VARCHAR(32) NOT NULL, 
	pack_id VARCHAR(32) NOT NULL, 
	PRIMARY KEY (card_id), 
	FOREIGN KEY(card_id) REFERENCES tavern_cards (id), 
	FOREIGN KEY(pack_id) REFERENCES scene_packs (id)
);

CREATE TABLE card_sprite_packs (
	card_id VARCHAR(32) NOT NULL, 
	pack_id VARCHAR(32) NOT NULL, 
	sort INTEGER NOT NULL, 
	is_current BOOLEAN NOT NULL, 
	PRIMARY KEY (card_id, pack_id), 
	FOREIGN KEY(card_id) REFERENCES tavern_cards (id), 
	FOREIGN KEY(pack_id) REFERENCES sprite_packs (id)
);

CREATE TABLE card_voices (
	card_id VARCHAR(32) NOT NULL, 
	profile_id VARCHAR(32) NOT NULL, 
	is_main BOOLEAN NOT NULL, 
	PRIMARY KEY (card_id, profile_id), 
	FOREIGN KEY(card_id) REFERENCES tavern_cards (id), 
	FOREIGN KEY(profile_id) REFERENCES voice_profiles (id)
);

CREATE TABLE client_blocks (
	id VARCHAR(32) NOT NULL, 
	kind VARCHAR(8) NOT NULL, 
	value VARCHAR(64) NOT NULL, 
	user_id VARCHAR(32), 
	created_at DATETIME NOT NULL, 
	expires_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE client_seen (
	user_id VARCHAR(32) NOT NULL, 
	kind VARCHAR(8) NOT NULL, 
	value VARCHAR(64) NOT NULL, 
	last_seen_at DATETIME NOT NULL, 
	PRIMARY KEY (user_id, kind, value), 
	FOREIGN KEY(user_id) REFERENCES users (id)
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
	parent_message_id VARCHAR(36), 
	owner_id VARCHAR(32), 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
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

CREATE TABLE moderation_cursors (
	user_id VARCHAR(32) NOT NULL, 
	judged_until DATETIME NOT NULL, 
	PRIMARY KEY (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE moderation_violations (
	id VARCHAR(32) NOT NULL, 
	user_id VARCHAR(32) NOT NULL, 
	created_at DATETIME NOT NULL, 
	kind VARCHAR(8) NOT NULL, 
	level VARCHAR(8) NOT NULL, 
	excerpt TEXT NOT NULL, 
	detail TEXT NOT NULL, 
	confidence FLOAT, 
	source VARCHAR(8) NOT NULL, 
	revoked BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE pack_sprites (
	id VARCHAR(32) NOT NULL, 
	pack_id VARCHAR(32) NOT NULL, 
	label VARCHAR(80) NOT NULL, 
	aliases JSON NOT NULL, 
	description TEXT NOT NULL, 
	image BLOB, 
	mime VARCHAR(40), 
	sort INTEGER NOT NULL, 
	enabled BOOLEAN NOT NULL, 
	face_scan JSON, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(pack_id) REFERENCES sprite_packs (id)
);

CREATE TABLE personas (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	description TEXT NOT NULL, 
	avatar TEXT, 
	is_active BOOLEAN NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE play_generations (
	id VARCHAR(32) NOT NULL, 
	user_id VARCHAR(32) NOT NULL, 
	created_at DATETIME NOT NULL, 
	day VARCHAR(10) NOT NULL, 
	source VARCHAR(8) NOT NULL, 
	own_host VARCHAR(255) NOT NULL, 
	model VARCHAR(200) NOT NULL, 
	prompt_chars INTEGER NOT NULL, 
	last_user_text TEXT NOT NULL, 
	reply_text TEXT NOT NULL, 
	status VARCHAR(12) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
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

CREATE TABLE scene_asset_lites (
	asset_id VARCHAR(32) NOT NULL, 
	source_version INTEGER NOT NULL, 
	data BLOB NOT NULL, 
	mime VARCHAR(40) NOT NULL, 
	size INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (asset_id)
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
	enabled BOOLEAN NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(pack_id) REFERENCES scene_packs (id)
);

CREATE TABLE scene_packs (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	description TEXT NOT NULL, 
	title_bgm_id VARCHAR(32), 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE sprite_pack_layouts (
	pack_id VARCHAR(32) NOT NULL, 
	auto BOOLEAN NOT NULL, 
	zoom FLOAT NOT NULL, 
	dx FLOAT NOT NULL, 
	dy FLOAT NOT NULL, 
	PRIMARY KEY (pack_id), 
	FOREIGN KEY(pack_id) REFERENCES sprite_packs (id)
);

CREATE TABLE sprite_packs (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	description TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
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
	last_chat_id VARCHAR(32), 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
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

CREATE TABLE user_policies (
	user_id VARCHAR(32) NOT NULL, 
	daily_limit INTEGER, 
	free BOOLEAN NOT NULL, 
	voice BOOLEAN NOT NULL, 
	PRIMARY KEY (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE user_presence (
	user_id VARCHAR(32) NOT NULL, 
	last_seen_at DATETIME NOT NULL, 
	PRIMARY KEY (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE user_sessions (
	token_hash VARCHAR(64) NOT NULL, 
	user_id VARCHAR(32) NOT NULL, 
	expires_at DATETIME NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (token_hash), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE users (
	id VARCHAR(32) NOT NULL, 
	username VARCHAR(40) NOT NULL, 
	username_key VARCHAR(40) NOT NULL, 
	password_hash VARCHAR(200) NOT NULL, 
	role VARCHAR(16) NOT NULL, 
	display_name VARCHAR(40) NOT NULL, 
	banned BOOLEAN NOT NULL, 
	register_ip VARCHAR(64) NOT NULL, 
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
	emo_vector JSON, 
	sort INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
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
	ref_path VARCHAR(500) NOT NULL, 
	text_lang VARCHAR(12) NOT NULL, 
	speed FLOAT NOT NULL, 
	params JSON NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(connection_id) REFERENCES tts_connections (id)
);

CREATE INDEX ix_card_scene_packs_pack_id ON card_scene_packs (pack_id);

CREATE INDEX ix_card_sprite_packs_pack_id ON card_sprite_packs (pack_id);

CREATE INDEX ix_card_voices_profile_id ON card_voices (profile_id);

CREATE INDEX ix_client_blocks_kind ON client_blocks (kind);

CREATE INDEX ix_client_blocks_user_id ON client_blocks (user_id);

CREATE INDEX ix_client_blocks_value ON client_blocks (value);

CREATE INDEX ix_client_seen_last_seen_at ON client_seen (last_seen_at);

CREATE INDEX ix_debug_chat_messages_chat_id ON debug_chat_messages (chat_id);

CREATE INDEX ix_debug_chats_card_id ON debug_chats (card_id);

CREATE INDEX ix_debug_chats_owner_id ON debug_chats (owner_id);

CREATE INDEX ix_moderation_violations_created_at ON moderation_violations (created_at);

CREATE INDEX ix_moderation_violations_user_id ON moderation_violations (user_id);

CREATE INDEX ix_pack_sprites_pack_id ON pack_sprites (pack_id);

CREATE INDEX ix_play_generations_created_at ON play_generations (created_at);

CREATE INDEX ix_play_generations_day ON play_generations (day);

CREATE INDEX ix_play_generations_user_id ON play_generations (user_id);

CREATE INDEX ix_scene_assets_pack_id ON scene_assets (pack_id);

CREATE INDEX ix_tts_cache_last_used_at ON tts_cache (last_used_at);

CREATE INDEX ix_user_presence_last_seen_at ON user_presence (last_seen_at);

CREATE INDEX ix_user_sessions_user_id ON user_sessions (user_id);

CREATE INDEX ix_users_register_ip ON users (register_ip);

CREATE UNIQUE INDEX ix_users_username_key ON users (username_key);

CREATE INDEX ix_voice_emotions_profile_id ON voice_emotions (profile_id);

CREATE INDEX ix_voice_profiles_connection_id ON voice_profiles (connection_id);

