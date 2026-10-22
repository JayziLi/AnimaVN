"""语音引擎的公共接口。

参考 SillyTavern 的 TTS 扩展:每个引擎实现同一组方法,上层不关心是哪家。
现在有 GPT-SoVITS(gpt_sovits.py)和 IndexTTS(indextts.py);以后接别的引擎,在 registry.py 里加一个分支。
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol


class ServerState:
    """一台语音服务(按地址)自己的状态:同一时刻只合成一句的锁、现在加载着哪组权重、热没热。
    几个连接指向同一台服务时共用这一份(素材架构设计 5.10 P21):不然各记各的「已加载」,会把别人刚换上的权重当成自己的"""

    def __init__(self) -> None:
        import asyncio

        self.lock = asyncio.Lock()
        self.loaded_gpt: str | None = None
        self.loaded_sovits: str | None = None
        self.warm = False


class SharedServer:
    """引擎类混入:lock / loaded_* / warm 读写的都是 state 里那份(引擎代码照旧写 self.lock 这些)"""

    state: ServerState

    @property
    def lock(self):
        return self.state.lock

    @property
    def loaded_gpt(self) -> str | None:
        return self.state.loaded_gpt

    @loaded_gpt.setter
    def loaded_gpt(self, value: str | None) -> None:
        self.state.loaded_gpt = value

    @property
    def loaded_sovits(self) -> str | None:
        return self.state.loaded_sovits

    @loaded_sovits.setter
    def loaded_sovits(self, value: str | None) -> None:
        self.state.loaded_sovits = value

    @property
    def warm(self) -> bool:
        return self.state.warm

    @warm.setter
    def warm(self, value: bool) -> None:
        self.state.warm = value


class TTSError(Exception):
    """合成失败。status 是回给前端的 HTTP 状态码,message 原样显示给人看。"""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class VoiceSpec:
    """一次合成要用的全部配置,API 层从声音和情绪行里拼好交给引擎。

    GSV:ref_path / prompt_text 是这一行情绪的参考音频和原文。
    IndexTTS:spk_ref_path 是声音的音色参考;ref_path 是可选的情绪参考;emo_vector 是
    8 维情绪向量(ref_path 非空时不用);prompt_text 不用。
    params:声音上调过的合成参数(schemas.VoiceParams,只含调过的项),各引擎只取自己认的。
    """

    gpt_weights: str
    sovits_weights: str
    ref_path: str
    prompt_text: str
    text_lang: str
    speed: float
    spk_ref_path: str = ""
    emo_vector: tuple[float, ...] | None = None
    # GSV 的辅助参考:音色和主参考一起取平均(v3 / v4 模型不认)
    aux_ref_paths: tuple[str, ...] = ()
    params: dict[str, Any] = field(default_factory=dict)


class TTSEngine(Protocol):
    def request_body(self, text: str, voice: VoiceSpec) -> dict[str, Any]:
        """发给语音服务的请求体(排查语音时原样给人看)。"""
        ...

    def cache_material(self, text: str, voice: VoiceSpec) -> dict[str, Any]:
        """决定合成结果的全部输入;缓存键就是它的哈希。"""
        ...

    async def synthesize(self, text: str, voice: VoiceSpec) -> tuple[bytes, str]:
        """返回 (音频字节, mime)。失败抛 TTSError。"""
        ...

    async def warmup(self, voice: VoiceSpec, force: bool) -> None:
        """让服务端加载好这个声音并合成一句。force:不信任记住的「当前权重」,强制重新切。"""
        ...

    async def ping(self) -> None:
        """只检查连不连得上。失败抛 TTSError。"""
        ...

    async def reference_audio(self, path: str) -> tuple[bytes, str]:
        """语音服务那台机器上的一段参考音频,原样取回(「语音详情」里试听)。失败抛 TTSError。"""
        ...

    async def download(self, path: str, dest: Path) -> int:
        """语音服务那台机器上的一个文件(参考音频、模型)整个拉下来写进 dest,返回字节数(导出声音包)。失败抛 TTSError。"""
        ...
