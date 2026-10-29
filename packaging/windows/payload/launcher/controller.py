"""后台的大脑(跑在 host.py 里):按设置开后端、游戏页面,到哪一步了,日志和常见报错。

启动器和游戏经 host.py 的本机小服务每隔一会儿来要一次 snapshot()。开进程、问地址、看时间都是传进来的,好测。
设置每次启动(和重启)时从文件重新读:启动器改了要重启的设置,点「重启」就用上新的。
"""

from __future__ import annotations

import threading
import time
from dataclasses import asdict

import diagnose
import net
import procs
import services
import settings as settings_mod
from layout import Layout

READY_TIMEOUT = 120  # 正常启动最多等这么久(秒)
MIGRATE_TIMEOUT = 1800  # 后端在升级存档时最多等半小时(和以前的 start.bat 一样)


class Controller:
    def __init__(self, layout: Layout, *, version: str = "", spawn=procs.Proc, answers=net.answers,
                 port_free=net.port_free, pick_port=net.pick_port, lan_ip=net.lan_ip, tailscale_ip=net.tailscale_ip,
                 sleep=time.sleep, clock=time.monotonic):
        self.layout, self.version = layout, version
        self._spawn, self._answers, self._port_free, self._pick_port = spawn, answers, port_free, pick_port
        self._lan_ip, self._tailscale_ip, self._sleep, self._clock = lan_ip, tailscale_ip, sleep, clock
        self.settings = settings_mod.load(layout.settings_file)
        self.phase, self.message = "idle", ""
        self.plan: services.Plan | None = None
        self.backend_port: int | None = None
        self.reused: set[str] = set()  # 已经有别人开着、直接拿来用的(以前开的 start.bat 窗口)
        self.procs: dict[str, procs.Proc] = {}
        self._lock = threading.RLock()
        self._gen = 0  # 每次启动加一;重启以后,旧的那次启动看到不是自己了就停手

    # ---- 启动 ----

    def start(self) -> None:
        threading.Thread(target=self.boot, daemon=True).start()

    def boot(self) -> None:
        with self._lock:
            self._gen += 1
            gen = self._gen
        try:
            self._boot(gen)
        except Exception as e:  # noqa: BLE001 —— 什么意外都要显示在界面上,不能卡在「正在启动」
            self._set(gen, "failed", f"启动出错了：{e}")

    def _set(self, gen: int, phase: str, message: str = "") -> bool:
        with self._lock:
            if gen != self._gen:
                return False
            self.phase, self.message = phase, message
            return True

    def _boot(self, gen: int) -> None:
        lay = self.layout
        self.settings = s = settings_mod.load(lay.settings_file)
        self._set(gen, "starting", "正在启动……")
        self.reused = set()
        if lay.kind == "portable":
            port = self._pick_port(s.port)
        else:
            port = s.port
            if self._answers(f"http://127.0.0.1:{port}/api/health"):
                self.reused.add("backend")
            elif not self._port_free(port):
                self._set(gen, "failed", f"端口 {port} 被别的程序占着。关掉以前开的 start.bat / play.bat 黑窗口，再点「重试」。")
                return
        self.backend_port = port
        self.plan = services.make_plan(lay, s, port)
        for step in self.plan.prepare:
            if not self._set(gen, "preparing", f"正在{step.label}……"):
                return
            if self._run(step).wait() != 0:
                self._set(gen, "failed", f"{step.label}失败了，控制台里有报错。")
                return
        for step in self.plan.services:
            if step.name in self.reused:
                continue
            if step.name != "backend" and self._answers(step.health):
                self.reused.add(step.name)  # 以前开的游戏页面服务还在:刚打包的新文件它会自己拿到
                continue
            self._run(step)
        self._set(gen, "starting", "正在启动……")
        for step in self.plan.services:
            if not self._wait_ready(gen, step):
                return
        self._set(gen, "ready")

    def _run(self, step: services.Step):
        p = self._spawn(step.name, step.cmd, step.cwd, env=step.env,
                        visible=self.settings.terminal and step.name == "backend",
                        log_file=self.layout.logs / f"{step.name}.log")
        with self._lock:
            self.procs[step.name] = p
        p.start()
        return p

    def _wait_ready(self, gen: int, step: services.Step) -> bool:
        t0 = self._clock()
        flag = self.layout.data / "animabackend.db.migrating"  # 后端升级数据库时留的(app/migrations)
        while True:
            if gen != self._gen:
                return False
            if self._answers(step.health):
                return True
            p = self.procs.get(step.name)
            if step.name not in self.reused and p is not None and not p.alive():
                self._set(gen, "failed", f"{step.label}没起来，控制台里有报错。")
                return False
            migrating = step.name == "backend" and flag.exists()
            if migrating:
                self._set(gen, "starting", "正在升级存档，存档大的话要几分钟，别关……")
            if self._clock() - t0 > (MIGRATE_TIMEOUT if migrating else READY_TIMEOUT):
                self._set(gen, "failed", f"{step.label}等了很久还没好，控制台里看看有没有报错。")
                return False
            self._sleep(0.5)

    # ---- 给界面 ----

    def base(self) -> str | None:
        return f"http://127.0.0.1:{self.backend_port}" if self.backend_port else None

    def game_url(self) -> str | None:
        return self.plan.game_url() if self.plan and self.phase == "ready" else None

    def lan_url(self) -> str | None:
        return self.plan.lan_url(self._lan_ip()) if self.plan and self.phase == "ready" else None

    def tailscale_url(self) -> str | None:
        """Wi-Fi 把设备隔开时,手机装 Tailscale 走这个"""
        return self.plan.lan_url(self._tailscale_ip()) if self.plan and self.phase == "ready" else None

    def snapshot(self) -> dict:
        with self._lock:
            steps = [*self.plan.prepare, *self.plan.services] if self.plan else []
            ps = dict(self.procs)
            lines = [line for p in ps.values() for line in p.tail(300)]
            return {
                "phase": self.phase,
                "message": self.message,
                "kind": self.layout.kind,
                "version": self.version,
                "booted": asdict(self.settings),  # 这次是按哪份设置开的(启动器拿它和文件比,看要不要重启)
                "base": self.base(),
                "game_url": self.game_url(),
                "lan_url": self.lan_url(),
                "tailscale_url": self.tailscale_url(),
                "logs": [{"name": st.name, "label": st.label, "alive": bool(ps.get(st.name) and ps[st.name].alive()),
                          "reused": st.name in self.reused}
                         for st in steps if st.name in ps or st.name in self.reused],
                "hints": diagnose.hints(lines),
            }

    def logs(self, name: str) -> list[str]:
        p = self.procs.get(name)
        if p is None:
            return ["（这个是以前就开着的，输出在它自己的窗口里）"] if name in self.reused else []
        return p.tail(1000)

    def restart(self) -> None:
        self.stop_all()
        self.boot()

    def stop_all(self) -> None:
        with self._lock:
            self._gen += 1
            ps, self.procs = list(self.procs.values()), {}
            self.phase, self.message = "stopped", ""
        for p in ps:
            p.stop()

    def shutdown(self) -> None:
        self.stop_all()
