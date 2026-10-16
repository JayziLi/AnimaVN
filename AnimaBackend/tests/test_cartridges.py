"""卡带登记处(app/plugins):在的卡带才加载,不在的跳过;卡带在、但缺了别的东西照样报错"""

import importlib
import sys
import types

import pytest
from fastapi import APIRouter

import app.plugins as plugins
from app.plugins import Cartridge, load_cartridges


def _fake_module(monkeypatch, name: str, **attrs) -> types.ModuleType:
    """假装 app.plugins.<name> 已经 import 过了(测试完拿掉)"""
    module = types.ModuleType(f"app.plugins.{name}")
    for key, value in attrs.items():
        setattr(module, key, value)
    monkeypatch.setitem(sys.modules, module.__name__, module)
    return module


def test_known_names_are_module_names():
    assert len(set(plugins.CARTRIDGE_MODULES)) == len(plugins.CARTRIDGE_MODULES)
    for name in plugins.CARTRIDGE_MODULES:
        assert name.isidentifier() and name == name.lower()


def test_missing_cartridge_is_skipped():
    assert load_cartridges(["fake_not_installed"]) == []


def test_loads_in_order_and_runs_on_load(monkeypatch):
    calls: list[str] = []
    router = APIRouter()
    one = _fake_module(
        monkeypatch,
        "fake_one",
        CARTRIDGE=Cartridge(id="fake-one", routers=[router], on_load=lambda: calls.append("one")),
    )
    two = _fake_module(monkeypatch, "fake_two", CARTRIDGE=Cartridge(id="fake-two"))
    got = load_cartridges(["fake_two", "fake_not_installed", "fake_one"])
    assert got == [two.CARTRIDGE, one.CARTRIDGE]
    assert got[1].routers == [router]
    assert got[0].routers == []
    assert calls == ["one"]


def test_module_without_cartridge_is_an_error(monkeypatch):
    _fake_module(monkeypatch, "fake_one")
    with pytest.raises(TypeError, match="CARTRIDGE"):
        load_cartridges(["fake_one"])
    _fake_module(monkeypatch, "fake_one", CARTRIDGE={"id": "fake-one"})
    with pytest.raises(TypeError, match="CARTRIDGE"):
        load_cartridges(["fake_one"])


def test_id_must_match_module_name(monkeypatch):
    _fake_module(monkeypatch, "fake_one", CARTRIDGE=Cartridge(id="fake_one"))
    with pytest.raises(ValueError, match="fake-one"):
        load_cartridges(["fake_one"])


def test_cartridge_missing_a_dependency_still_fails(tmp_path, monkeypatch):
    """卡带文件在,它 import 的东西不在:不能当成「卡带没装」悄悄跳过"""
    (tmp_path / "fake_broken.py").write_text("import fake_missing_dependency_xyz\n", encoding="utf-8")
    monkeypatch.setattr(plugins, "__path__", [*plugins.__path__, str(tmp_path)])
    importlib.invalidate_caches()
    with pytest.raises(ModuleNotFoundError) as caught:
        load_cartridges(["fake_broken"])
    assert caught.value.name == "fake_missing_dependency_xyz"
    assert "app.plugins.fake_broken" not in sys.modules


def test_real_cartridge_file_loads(tmp_path, monkeypatch):
    """真的从文件 import 一遍(不是塞进 sys.modules 的假模块)"""
    (tmp_path / "fake_file.py").write_text(
        "from fastapi import APIRouter\n"
        "from app.plugins import Cartridge\n"
        "router = APIRouter()\n"
        "CARTRIDGE = Cartridge(id='fake-file', routers=[router])\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(plugins, "__path__", [*plugins.__path__, str(tmp_path)])
    monkeypatch.delitem(sys.modules, "app.plugins.fake_file", raising=False)
    importlib.invalidate_caches()
    try:
        (got,) = load_cartridges(["fake_file"])
        assert got.id == "fake-file"
        assert got.routers == [sys.modules["app.plugins.fake_file"].router]
    finally:
        sys.modules.pop("app.plugins.fake_file", None)
        vars(plugins).pop("fake_file", None)
