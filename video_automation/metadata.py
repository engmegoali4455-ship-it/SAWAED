"""Auto-generated titles, descriptions and hashtags for each video."""
from __future__ import annotations

import random
import re
from dataclasses import asdict, dataclass

import config


@dataclass
class VideoMetadata:
    title: str
    description: str
    tags: list[str]
    hashtags: list[str]

    @property
    def caption(self) -> str:
        """Single text block for Instagram / Facebook / TikTok."""
        return f"{self.title}\n\n{self.description}".strip()

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "VideoMetadata":
        return cls(**data)


def _clean_name(stem: str) -> str:
    name = re.sub(r"[_\-]+", " ", stem)
    name = re.sub(r"\s+", " ", name).strip()
    return name.title() if name.isascii() else name


def generate_metadata(audio_stem: str, transcript: str = "") -> VideoMetadata:
    name = _clean_name(audio_stem) or "New Drop"
    snippet = " ".join(transcript.split()[:6]) or name

    template = random.choice(config.TITLE_TEMPLATES)
    title = template.format(name=name, snippet=snippet).strip()

    unique = list(dict.fromkeys(config.HASHTAGS))  # de-duplicate, keep order
    core, extra = unique[:3], unique[3:]  # keep the first few (core tags) fixed
    random.shuffle(extra)
    hashtags = core + extra

    # YouTube titles max 100 chars; "#Shorts" in the title helps classification.
    if "#shorts" not in title.lower():
        title = f"{title[:90]} #Shorts"
    title = title[:100]

    lines = []
    if transcript:
        lines.append(f"🎶 {snippet}...")
    if config.EXTRA_DESCRIPTION:
        lines.append(config.EXTRA_DESCRIPTION)
    lines.append(" ".join(hashtags))
    description = "\n\n".join(lines)

    tags = [h.lstrip("#") for h in hashtags]
    return VideoMetadata(title=title, description=description, tags=tags, hashtags=hashtags)
