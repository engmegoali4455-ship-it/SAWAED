"""The Maker: turns an audio file + background into a 9:16 kinetic-lyrics video.

Pipeline:
    1. Whisper transcribes the audio with word-level timestamps.
    2. Words are grouped into short on-screen "chunks" (a few words each).
    3. Every chunk is drawn with Pillow (Arabic shaped via arabic-reshaper and
       python-bidi); words appear one by one as they are sung, the current one
       highlighted.
    4. MoviePy composites background + dim layer + text layers + audio and
       renders an H.264/AAC MP4 into ``output/``.
"""
from __future__ import annotations

import logging
import random
import re
import time
from dataclasses import dataclass
from pathlib import Path

import arabic_reshaper
import numpy as np
from bidi.algorithm import get_display
from moviepy import (
    AudioFileClip,
    ColorClip,
    CompositeVideoClip,
    ImageClip,
    VideoFileClip,
    afx,
    vfx,
)
from PIL import Image, ImageColor, ImageDraw, ImageFont

import config

log = logging.getLogger(__name__)

ARABIC_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")

FALLBACK_FONTS = [
    "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # has Arabic glyphs
    "C:/Windows/Fonts/arialbd.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]


@dataclass
class Word:
    text: str
    start: float
    end: float


# --------------------------------------------------------------------------- #
# Transcription
# --------------------------------------------------------------------------- #
class Transcriber:
    """Lazy-loading wrapper around openai-whisper (the model is loaded once)."""

    def __init__(self, model_name: str = config.WHISPER_MODEL,
                 language: str | None = config.WHISPER_LANGUAGE,
                 device: str | None = config.WHISPER_DEVICE):
        self.model_name = model_name
        self.language = language
        self.device = device
        self._model = None

    def _load(self):
        if self._model is None:
            import whisper  # heavy import (torch), only when actually needed

            log.info("Loading Whisper model '%s'...", self.model_name)
            self._model = whisper.load_model(self.model_name, device=self.device)
        return self._model

    def transcribe(self, audio_path: Path, max_duration: float | None = None) -> list[Word]:
        model = self._load()
        started = time.time()
        result = model.transcribe(
            str(audio_path),
            language=self.language,
            word_timestamps=True,
            fp16=model.device.type == "cuda",
            condition_on_previous_text=False,  # reduces repetition loops on songs
            verbose=None,
        )
        words: list[Word] = []
        for segment in result.get("segments", []):
            for w in segment.get("words", []):
                text = w["word"].strip()
                if not text:
                    continue
                if max_duration is not None and w["start"] >= max_duration:
                    continue
                words.append(Word(text, float(w["start"]), float(w["end"])))
        log.info("Transcribed %s: %d words in %.1fs", audio_path.name, len(words),
                 time.time() - started)
        return words


# --------------------------------------------------------------------------- #
# Text rendering (Pillow)
# --------------------------------------------------------------------------- #
def resolve_font_path(font_path: str = config.FONT_PATH) -> str:
    candidates = [Path(font_path)]
    if not Path(font_path).is_absolute():
        candidates.insert(0, config.BASE_DIR / font_path)
    candidates += sorted(config.FONTS_DIR.glob("*.ttf")) + sorted(config.FONTS_DIR.glob("*.otf"))
    candidates += [Path(p) for p in FALLBACK_FONTS]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    raise FileNotFoundError(
        "No usable font found. Download an Arabic font (e.g. Cairo or Tajawal from "
        "Google Fonts) into the fonts/ folder and set FONT_PATH in .env."
    )


class KineticTextRenderer:
    """Draws a chunk of words onto a transparent RGBA canvas.

    The layout of a chunk is computed once, so words don't shift position as
    they are revealed. Right-to-left chunks (Arabic) are laid out from the
    right edge of each line.
    """

    def __init__(self, width: int = config.VIDEO_WIDTH):
        self.canvas_width = width
        self.max_line_width = int(width * config.TEXT_MAX_WIDTH)
        font_file = resolve_font_path()
        log.debug("Using font %s", font_file)
        # BASIC layout + manual reshaping works everywhere (no libraqm needed).
        self.font = ImageFont.truetype(font_file, config.FONT_SIZE,
                                       layout_engine=ImageFont.Layout.BASIC)
        self.text_color = ImageColor.getrgb(config.TEXT_COLOR)
        self.highlight_color = ImageColor.getrgb(config.HIGHLIGHT_COLOR)
        self.stroke_color = ImageColor.getrgb(config.STROKE_COLOR)
        self.stroke = config.STROKE_WIDTH
        ascent, descent = self.font.getmetrics()
        self.line_height = int((ascent + descent) * 1.25) + self.stroke * 2
        self.space = int(self.font.getlength(" ") * 1.2)

    @staticmethod
    def _visual(word: str) -> str:
        """Shape Arabic letters and convert to visual (display) order."""
        if ARABIC_RE.search(word):
            return get_display(arabic_reshaper.reshape(word))
        return word

    def _width(self, text: str) -> int:
        return int(self.font.getlength(text)) + self.stroke * 2

    def layout(self, words: list[str]) -> tuple[list[tuple[int, int, str]], int]:
        """Return [(x, y, visual_text)] per word (logical order) and canvas height."""
        rtl = any(ARABIC_RE.search(w) for w in words)
        visuals = [self._visual(w) for w in words]
        widths = [self._width(v) for v in visuals]

        lines: list[list[int]] = [[]]
        line_width = 0
        for i, w in enumerate(widths):
            needed = w if not lines[-1] else line_width + self.space + w
            if lines[-1] and needed > self.max_line_width:
                lines.append([i])
                line_width = w
            else:
                lines[-1].append(i)
                line_width = needed

        positions: list[tuple[int, int, str]] = [(0, 0, "")] * len(words)
        padding = self.stroke * 2 + 10
        for row, indices in enumerate(lines):
            total = sum(widths[i] for i in indices) + self.space * (len(indices) - 1)
            y = padding + row * self.line_height
            if rtl:
                cursor = (self.canvas_width + total) // 2
                for i in indices:
                    cursor -= widths[i]
                    positions[i] = (cursor, y, visuals[i])
                    cursor -= self.space
            else:
                cursor = (self.canvas_width - total) // 2
                for i in indices:
                    positions[i] = (cursor, y, visuals[i])
                    cursor += widths[i] + self.space
        height = padding * 2 + len(lines) * self.line_height
        return positions, height

    def render(self, layout: tuple[list[tuple[int, int, str]], int],
               visible: int, active: int) -> np.ndarray:
        positions, height = layout
        image = Image.new("RGBA", (self.canvas_width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        for i, (x, y, text) in enumerate(positions[:visible]):
            color = self.highlight_color if i == active else self.text_color
            # soft drop shadow, then the stroked word itself
            draw.text((x + 4, y + 6), text, font=self.font, fill=(0, 0, 0, 140),
                      stroke_width=self.stroke, stroke_fill=(0, 0, 0, 140))
            draw.text((x, y), text, font=self.font, fill=color,
                      stroke_width=self.stroke, stroke_fill=self.stroke_color)
        return np.array(image)


def group_words(words: list[Word], max_words: int = config.WORDS_PER_CHUNK,
                gap: float = config.CHUNK_GAP_SECONDS) -> list[list[Word]]:
    chunks: list[list[Word]] = []
    for word in words:
        if (not chunks or len(chunks[-1]) >= max_words
                or word.start - chunks[-1][-1].end > gap):
            chunks.append([word])
        else:
            chunks[-1].append(word)
    return chunks


def build_text_clips(words: list[Word], duration: float,
                     renderer: KineticTextRenderer) -> list[ImageClip]:
    """One ImageClip per reveal step: the chunk grows word by word."""
    clips: list[ImageClip] = []
    chunks = group_words(words)
    center_y = int(config.VIDEO_HEIGHT * config.TEXT_POSITION_Y)

    for c, chunk in enumerate(chunks):
        layout = renderer.layout([w.text for w in chunk])
        next_chunk_start = chunks[c + 1][0].start if c + 1 < len(chunks) else duration
        chunk_end = min(max(chunk[-1].end + 0.4, chunk[-1].start + 0.3), next_chunk_start, duration)
        top = center_y - layout[1] // 2

        for i, word in enumerate(chunk):
            start = word.start
            end = chunk[i + 1].start if i + 1 < len(chunk) else chunk_end
            if end - start < 0.04 or start >= duration:
                continue
            frame = renderer.render(layout, visible=i + 1, active=i)
            clip = ImageClip(frame).with_start(start).with_duration(end - start)

            if i == 0 and config.POP_IN_SECONDS > 0:
                # small "pop" when a new chunk appears; keep it centred while scaling
                pop = config.POP_IN_SECONDS
                w0, h0 = frame.shape[1], frame.shape[0]

                def scale(t, pop=pop):
                    return 0.85 + 0.15 * min(1.0, t / pop)

                def position(t, w0=w0, h0=h0, top=top, scale=scale):
                    s = scale(t)
                    return (int((config.VIDEO_WIDTH - w0 * s) / 2), int(top + h0 * (1 - s) / 2))

                clip = clip.resized(scale).with_position(position)
            else:
                clip = clip.with_position(("center", top))
            clips.append(clip)
    return clips


# --------------------------------------------------------------------------- #
# Background
# --------------------------------------------------------------------------- #
def _cover(clip, width: int, height: int):
    """Scale to fill the frame, then centre-crop to exactly width x height."""
    scale = max(width / clip.w, height / clip.h)
    clip = clip.resized(scale)
    return clip.cropped(x_center=clip.w / 2, y_center=clip.h / 2, width=width, height=height)


def build_background(path: Path, duration: float):
    W, H = config.VIDEO_WIDTH, config.VIDEO_HEIGHT
    suffix = path.suffix.lower()

    if suffix in config.IMAGE_EXTENSIONS:
        clip = _cover(ImageClip(str(path)), W, H).with_duration(duration)
        if config.KEN_BURNS:
            zoom = lambda t: 1.0 + 0.08 * (t / duration)  # noqa: E731
            clip = clip.resized(zoom).with_position(
                lambda t: (-(W * zoom(t) - W) / 2, -(H * zoom(t) - H) / 2)
            )
        return clip

    if suffix in config.VIDEO_EXTENSIONS:
        clip = VideoFileClip(str(path), audio=False)
        if clip.duration > duration:
            offset = random.uniform(0, clip.duration - duration)
            clip = clip.subclipped(offset, offset + duration)
        else:
            clip = clip.with_effects([vfx.Loop(duration=duration)])
        return _cover(clip, W, H).with_duration(duration)

    raise ValueError(f"Unsupported background type: {path}")


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
@dataclass
class RenderResult:
    video_path: Path
    audio_path: Path
    background_path: Path
    words: list[Word]
    duration: float

    @property
    def transcript(self) -> str:
        return " ".join(w.text for w in self.words)


def _safe_stem(name: str) -> str:
    stem = re.sub(r"[^\w\-]+", "_", name, flags=re.UNICODE).strip("_")
    return stem[:60] or "video"


class VideoMaker:
    def __init__(self, transcriber: Transcriber | None = None):
        self.transcriber = transcriber or Transcriber()
        self._renderer: KineticTextRenderer | None = None

    @property
    def renderer(self) -> KineticTextRenderer:
        if self._renderer is None:
            self._renderer = KineticTextRenderer()
        return self._renderer

    def make(self, audio_path: Path, background_path: Path,
             output_dir: Path = config.OUTPUT_DIR) -> RenderResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        started = time.time()
        log.info("Rendering: audio=%s background=%s", audio_path.name, background_path.name)

        audio = AudioFileClip(str(audio_path))
        duration = min(audio.duration, config.MAX_DURATION)
        audio = audio.subclipped(0, duration)
        if config.AUDIO_FADE_OUT > 0:
            audio = audio.with_effects([afx.AudioFadeOut(min(config.AUDIO_FADE_OUT, duration / 4))])

        words = self.transcriber.transcribe(audio_path, max_duration=duration)
        if not words:
            log.warning("No lyrics detected in %s; rendering without text.", audio_path.name)

        background = build_background(background_path, duration)
        layers = [background]
        if config.BACKGROUND_DIM > 0:
            layers.append(
                ColorClip((config.VIDEO_WIDTH, config.VIDEO_HEIGHT), color=(0, 0, 0))
                .with_opacity(config.BACKGROUND_DIM)
                .with_duration(duration)
            )
        layers += build_text_clips(words, duration, self.renderer)

        final = (
            CompositeVideoClip(layers, size=(config.VIDEO_WIDTH, config.VIDEO_HEIGHT))
            .with_duration(duration)
            .with_audio(audio)
        )
        stamp = time.strftime("%Y%m%d_%H%M%S")
        out_path = output_dir / f"{stamp}_{_safe_stem(audio_path.stem)}.mp4"
        try:
            final.write_videofile(
                str(out_path),
                fps=config.VIDEO_FPS,
                codec="libx264",
                audio_codec="aac",
                audio_fps=44100,
                audio_bitrate="192k",
                preset=config.RENDER_PRESET,
                threads=config.RENDER_THREADS,
                ffmpeg_params=["-pix_fmt", "yuv420p", "-movflags", "+faststart", "-crf", "20"],
                temp_audiofile_path=str(output_dir),
                logger=None,
            )
        finally:
            final.close()
            audio.close()
            background.close()

        log.info("Rendered %s (%.1fs video) in %.0fs", out_path.name, duration, time.time() - started)
        return RenderResult(out_path, audio_path, background_path, words, duration)
