"""Jev 用量:每次问 Jev 回来以后按天记一笔(判断、试判、测试都算),Jev 页显示今天 / 这 7 天 / 这个月 / 全部。

只数 token 不算钱:走中转的价格各不一样。1 秒没回重发的那份也发出去了,按两次记(token 按同一个请求算)。
并行的请求同时记账:一条 INSERT … ON CONFLICT 加上去,不会互相盖掉。
"""

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from app.models import JevUsage


def today() -> date:
    """本机日期(测试里换掉)"""
    return date.today()


def record(db: Session, requests: int, tokens: int) -> None:
    stmt = insert(JevUsage).values(day=today().isoformat(), requests=requests, input_tokens=tokens)
    stmt = stmt.on_conflict_do_update(
        index_elements=[JevUsage.day],
        set_={
            "requests": JevUsage.requests + stmt.excluded.requests,
            "input_tokens": JevUsage.input_tokens + stmt.excluded.input_tokens,
        },
    )
    db.execute(stmt)
    db.commit()


@dataclass(frozen=True)
class Total:
    requests: int
    tokens: int


def _total(db: Session, since: date | None) -> Total:
    q = select(func.coalesce(func.sum(JevUsage.requests), 0), func.coalesce(func.sum(JevUsage.input_tokens), 0))
    if since is not None:
        q = q.where(JevUsage.day >= since.isoformat())
    requests, tokens = db.execute(q).one()
    return Total(int(requests), int(tokens))


def summary(db: Session) -> dict[str, Total]:
    """今天、这 7 天(含今天)、这个月、全部"""
    d = today()
    return {
        "today": _total(db, d),
        "week": _total(db, d - timedelta(days=6)),
        "month": _total(db, d.replace(day=1)),
        "all": _total(db, None),
    }
