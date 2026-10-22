"""声音包(素材架构第 4 步):声音、情绪补上文件仓库里的指纹、模型的大小和原文件名、来源和授权、「文件在哪」。

只补列:原有的声音 files_at 是 manual(路径是手填的语音机路径,和以前一样),指纹都是空的;路径、请求体、缓存键都不动。
"""

from app.migrations.sqlite_util import add_columns_step

STEP = add_columns_step(
    "core.2026_10_voice_files",
    "声音包:参考音频和模型的指纹、来源授权、文件在哪",
    [
        ("voice_profiles", "gpt_sha", "VARCHAR(64)"),
        ("voice_profiles", "gpt_size", "INTEGER"),
        ("voice_profiles", "gpt_name", "VARCHAR(255) NOT NULL DEFAULT ''"),
        ("voice_profiles", "sovits_sha", "VARCHAR(64)"),
        ("voice_profiles", "sovits_size", "INTEGER"),
        ("voice_profiles", "sovits_name", "VARCHAR(255) NOT NULL DEFAULT ''"),
        ("voice_profiles", "speaker_sha", "VARCHAR(64)"),
        ("voice_profiles", "source", "TEXT NOT NULL DEFAULT ''"),
        ("voice_profiles", "license", "TEXT NOT NULL DEFAULT ''"),
        ("voice_profiles", "files_at", "VARCHAR(16) NOT NULL DEFAULT 'manual'"),
        ("voice_emotions", "ref_sha", "VARCHAR(64)"),
        ("voice_emotions", "aux_shas", "JSON NOT NULL DEFAULT '[]'"),
    ],
    depends=("core.2026_10_voice_aux_refs",),
)
