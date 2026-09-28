"""Central configuration for the automation system.

Every value can be overridden from the ``.env`` file (see ``.env.example``).
Other modules import settings from here; nothing else reads ``os.environ``.
"""
from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _str(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value and value.strip() else default


def _float(name: str, default: float) -> float:
    value = os.getenv(name)
    return float(value) if value and value.strip() else default


def _list(name: str, default: str, sep: str = ",") -> list[str]:
    raw = os.getenv(name) or default
    return [item.strip() for item in raw.split(sep) if item.strip()]


def _path(name: str, default: str) -> Path:
    path = Path(_str(name, default)).expanduser()
    return path if path.is_absolute() else BASE_DIR / path


# --------------------------------------------------------------------------- #
# Folders
# --------------------------------------------------------------------------- #
AUDIO_DIR = _path("AUDIO_DIR", "input/audio")
BACKGROUNDS_DIR = _path("BACKGROUNDS_DIR", "input/backgrounds")
OUTPUT_DIR = _path("OUTPUT_DIR", "output")
ARCHIVE_DIR = _path("ARCHIVE_DIR", "archive")
STATE_DIR = _path("STATE_DIR", "state")
LOG_DIR = _path("LOG_DIR", "logs")
FONTS_DIR = BASE_DIR / "fonts"

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

# --------------------------------------------------------------------------- #
# Video rendering
# --------------------------------------------------------------------------- #
VIDEO_WIDTH = _int("VIDEO_WIDTH", 1080)
VIDEO_HEIGHT = _int("VIDEO_HEIGHT", 1920)
VIDEO_FPS = _int("VIDEO_FPS", 30)
MAX_DURATION = _float("MAX_DURATION", 59.0)  # keep < 60s so it's a Short everywhere
AUDIO_FADE_OUT = _float("AUDIO_FADE_OUT", 1.5)
BACKGROUND_DIM = _float("BACKGROUND_DIM", 0.35)  # 0 = no darkening, 1 = black
KEN_BURNS = _bool("KEN_BURNS", True)  # slow zoom on still-image backgrounds
RENDER_THREADS = _int("RENDER_THREADS", os.cpu_count() or 2)
RENDER_PRESET = _str("RENDER_PRESET", "medium")

# --------------------------------------------------------------------------- #
# Transcription (openai-whisper)
# --------------------------------------------------------------------------- #
WHISPER_MODEL = _str("WHISPER_MODEL", "small")  # tiny/base/small/medium/large-v3/turbo
WHISPER_LANGUAGE = _str("WHISPER_LANGUAGE", "ar") or None  # empty = auto-detect
WHISPER_DEVICE = _str("WHISPER_DEVICE", "") or None  # "cuda", "cpu" or empty = auto

# --------------------------------------------------------------------------- #
# Kinetic typography
# --------------------------------------------------------------------------- #
FONT_PATH = _str("FONT_PATH", "fonts/Cairo-Bold.ttf")
FONT_SIZE = _int("FONT_SIZE", 96)
TEXT_COLOR = _str("TEXT_COLOR", "#FFFFFF")
HIGHLIGHT_COLOR = _str("HIGHLIGHT_COLOR", "#FFD400")
STROKE_COLOR = _str("STROKE_COLOR", "#000000")
STROKE_WIDTH = _int("STROKE_WIDTH", 6)
WORDS_PER_CHUNK = _int("WORDS_PER_CHUNK", 4)
TEXT_MAX_WIDTH = _float("TEXT_MAX_WIDTH", 0.86)  # fraction of video width
TEXT_POSITION_Y = _float("TEXT_POSITION_Y", 0.62)  # vertical centre, fraction of height
CHUNK_GAP_SECONDS = _float("CHUNK_GAP_SECONDS", 1.0)  # silence that starts a new chunk
POP_IN_SECONDS = _float("POP_IN_SECONDS", 0.12)

# --------------------------------------------------------------------------- #
# Scheduling
# --------------------------------------------------------------------------- #
VIDEOS_PER_DAY = _int("VIDEOS_PER_DAY", 5)
DAILY_RUN_TIME = _str("DAILY_RUN_TIME", "08:00")  # HH:MM, machine local time
RUN_ON_START = _bool("RUN_ON_START", True)  # produce today's batch at start if missing
FIRST_UPLOAD_DELAY_MINUTES = _int("FIRST_UPLOAD_DELAY_MINUTES", 10)
UPLOAD_INTERVAL_HOURS = _float("UPLOAD_INTERVAL_HOURS", 3.5)
UPLOAD_JITTER_MINUTES = _int("UPLOAD_JITTER_MINUTES", 20)
MIN_UPLOAD_GAP_MINUTES = _int("MIN_UPLOAD_GAP_MINUTES", 60)
MAX_UPLOAD_ATTEMPTS = _int("MAX_UPLOAD_ATTEMPTS", 3)
RETRY_DELAY_MINUTES = _int("RETRY_DELAY_MINUTES", 30)
DELETE_VIDEO_AFTER_UPLOAD = _bool("DELETE_VIDEO_AFTER_UPLOAD", False)

# --------------------------------------------------------------------------- #
# Metadata
# --------------------------------------------------------------------------- #
TITLE_TEMPLATES = _list(
    "TITLE_TEMPLATES",
    "{name} 🎵|Listen to this 🔥 {name}|{snippet}...|Wait for it 🎶 {name}",
    sep="|",
)
HASHTAGS = _list("HASHTAGS", "#Reels,#Shorts,#Trending,#Viral,#Music,#FYP,#Explore")
EXTRA_DESCRIPTION = _str("EXTRA_DESCRIPTION", "")

# --------------------------------------------------------------------------- #
# Platforms
# --------------------------------------------------------------------------- #
ENABLE_YOUTUBE = _bool("ENABLE_YOUTUBE", True)
ENABLE_FACEBOOK = _bool("ENABLE_FACEBOOK", True)
ENABLE_INSTAGRAM = _bool("ENABLE_INSTAGRAM", True)
ENABLE_TIKTOK = _bool("ENABLE_TIKTOK", True)

HTTP_TIMEOUT = _int("HTTP_TIMEOUT", 60)
UPLOAD_TIMEOUT = _int("UPLOAD_TIMEOUT", 900)
PROCESSING_TIMEOUT = _int("PROCESSING_TIMEOUT", 900)  # wait for platform-side processing

# YouTube
YOUTUBE_CLIENT_SECRETS_FILE = _path("YOUTUBE_CLIENT_SECRETS_FILE", "client_secret.json")
YOUTUBE_TOKEN_FILE = _path("YOUTUBE_TOKEN_FILE", "state/youtube_token.json")
YOUTUBE_PRIVACY = _str("YOUTUBE_PRIVACY", "public")  # public / unlisted / private
YOUTUBE_CATEGORY_ID = _str("YOUTUBE_CATEGORY_ID", "10")  # 10 = Music

# Meta (Facebook + Instagram)
META_APP_ID = _str("META_APP_ID")
META_APP_SECRET = _str("META_APP_SECRET")
META_GRAPH_VERSION = _str("META_GRAPH_VERSION", "v23.0")
FACEBOOK_PAGE_ID = _str("FACEBOOK_PAGE_ID")
FACEBOOK_PAGE_ACCESS_TOKEN = _str("FACEBOOK_PAGE_ACCESS_TOKEN")
INSTAGRAM_USER_ID = _str("INSTAGRAM_USER_ID")
INSTAGRAM_ACCESS_TOKEN = _str("INSTAGRAM_ACCESS_TOKEN") or FACEBOOK_PAGE_ACCESS_TOKEN
INSTAGRAM_SHARE_TO_FEED = _bool("INSTAGRAM_SHARE_TO_FEED", True)

# TikTok
TIKTOK_CLIENT_KEY = _str("TIKTOK_CLIENT_KEY")
TIKTOK_CLIENT_SECRET = _str("TIKTOK_CLIENT_SECRET")
TIKTOK_REDIRECT_URI = _str("TIKTOK_REDIRECT_URI")
TIKTOK_ACCESS_TOKEN = _str("TIKTOK_ACCESS_TOKEN")
TIKTOK_REFRESH_TOKEN = _str("TIKTOK_REFRESH_TOKEN")
TIKTOK_TOKEN_FILE = _path("TIKTOK_TOKEN_FILE", "state/tiktok_token.json")
TIKTOK_POST_MODE = _str("TIKTOK_POST_MODE", "direct").lower()  # direct / inbox
TIKTOK_PRIVACY_LEVEL = _str("TIKTOK_PRIVACY_LEVEL", "SELF_ONLY")  # unaudited apps: SELF_ONLY

# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #
LOG_LEVEL = _str("LOG_LEVEL", "INFO").upper()


def ensure_directories() -> None:
    for folder in (AUDIO_DIR, BACKGROUNDS_DIR, OUTPUT_DIR, ARCHIVE_DIR, STATE_DIR, LOG_DIR):
        folder.mkdir(parents=True, exist_ok=True)


def setup_logging() -> None:
    ensure_directories()
    fmt = logging.Formatter("%(asctime)s | %(levelname)-7s | %(name)s | %(message)s")
    root = logging.getLogger()
    root.setLevel(LOG_LEVEL)
    root.handlers.clear()

    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root.addHandler(console)

    file_handler = RotatingFileHandler(
        LOG_DIR / "automation.log", maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    root.addHandler(file_handler)

    # Third-party libraries are chatty at INFO.
    for noisy in ("googleapiclient.discovery_cache", "urllib3", "PIL"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
