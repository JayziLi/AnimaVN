import logging

from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, text

from app.schema_check import missing_columns, warn_missing_columns


def _metadata() -> MetaData:
    md = MetaData()
    Table("pack_sprites", md, Column("id", Integer, primary_key=True), Column("effect", String))
    Table("brand_new", md, Column("id", Integer, primary_key=True))
    return md


def test_reports_columns_an_existing_table_lacks_but_not_missing_tables():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE pack_sprites (id INTEGER PRIMARY KEY)"))

    assert missing_columns(engine, _metadata()) == [("pack_sprites", "effect")]


def test_warning_names_the_migration_script(caplog):
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE pack_sprites (id INTEGER PRIMARY KEY)"))

    with caplog.at_level(logging.WARNING, logger="app.schema_check"):
        warn_missing_columns(engine, _metadata())

    assert "pack_sprites.effect" in caplog.text
    assert "migrate_sprite_effect_column.py" in caplog.text


def test_up_to_date_schema_is_quiet(caplog):
    engine = create_engine("sqlite://")
    md = _metadata()
    md.create_all(engine)

    with caplog.at_level(logging.WARNING, logger="app.schema_check"):
        assert warn_missing_columns(engine, md) == []
    assert caplog.text == ""
