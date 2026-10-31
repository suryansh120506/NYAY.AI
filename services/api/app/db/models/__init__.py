from .base import Base
from .tables import *  # noqa: F403  (register every table on Base.metadata)

__all__ = ["Base"]
