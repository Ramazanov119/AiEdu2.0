"""Use pinned IANA data, not an outdated system/Conda tz database."""

from functools import lru_cache
from importlib.resources import files
from zoneinfo import ZoneInfo


@lru_cache(maxsize=16)
def load_zone(key: str):
    if not key or key.startswith("/") or ".." in key.split("/"):
        raise ValueError("Invalid timezone")
    with files("tzdata.zoneinfo").joinpath(*key.split("/")).open("rb") as source:
        return ZoneInfo.from_file(source, key=key)
