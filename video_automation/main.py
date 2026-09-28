"""The Manager: renders a daily batch of videos and uploads them spaced through the day.

Usage:
    python main.py                    # run forever (daily batch + spaced uploads)
    python main.py --batch-now        # produce a batch immediately, then keep running
    python main.py --once             # render ONE video and upload it right away (test)
    python main.py --render-only 2    # render 2 videos, no upload, no archiving
    python main.py --status           # show the upload queue
    python main.py --auth youtube     # one-time OAuth for YouTube   (also: tiktok)
    python main.py --auth meta --token <SHORT_LIVED_USER_TOKEN>

State lives in state/queue.json, so the process can be restarted at any time
without losing or duplicating scheduled uploads.
"""
from __future__ import annotations

import argparse
import json
import logging
import random
import shutil
import signal
import sys
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import schedule

import config
from metadata import VideoMetadata, generate_metadata

log = logging.getLogger("manager")

QUEUE_FILE = config.STATE_DIR / "queue.json"


# --------------------------------------------------------------------------- #
# Persistent queue
# --------------------------------------------------------------------------- #
def _now() -> datetime:
    return datetime.now().astimezone()


class JobQueue:
    def __init__(self, path: Path = QUEUE_FILE):
        self.path = path
        self.data = {"jobs": [], "last_batch_date": None, "last_upload_at": None}
        if path.exists():
            self.data.update(json.loads(path.read_text(encoding="utf-8")))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)  # atomic

    @property
    def jobs(self) -> list[dict]:
        return self.data["jobs"]

    def pending(self) -> list[dict]:
        return [j for j in self.jobs if j["status"] == "pending"]

    def reserved_audio(self) -> set[str]:
        return {j["audio"] for j in self.pending()}


# --------------------------------------------------------------------------- #
# Input selection & archiving
# --------------------------------------------------------------------------- #
def list_files(folder: Path, extensions: set[str]) -> list[Path]:
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in extensions)


def pick_inputs(count: int, exclude: set[str]) -> list[tuple[Path, Path]]:
    audios = [a for a in list_files(config.AUDIO_DIR, config.AUDIO_EXTENSIONS) if str(a) not in exclude]
    backgrounds = list_files(config.BACKGROUNDS_DIR, config.VIDEO_EXTENSIONS | config.IMAGE_EXTENSIONS)
    if not audios:
        log.warning("No unused audio files in %s", config.AUDIO_DIR)
        return []
    if not backgrounds:
        log.warning("No backgrounds in %s", config.BACKGROUNDS_DIR)
        return []
    if len(audios) < count:
        log.warning("Only %d unused audio file(s) available (wanted %d)", len(audios), count)

    chosen_audio = random.sample(audios, min(count, len(audios)))
    # avoid repeating a background within the batch when possible
    pool = random.sample(backgrounds, len(backgrounds))
    chosen_bg = [pool[i % len(pool)] for i in range(len(chosen_audio))]
    return list(zip(chosen_audio, chosen_bg))


def archive_audio(audio: Path) -> None:
    if not audio.exists():
        return
    config.ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    target = config.ARCHIVE_DIR / audio.name
    if target.exists():
        target = target.with_name(f"{audio.stem}_{int(time.time())}{audio.suffix}")
    shutil.move(str(audio), str(target))
    log.info("Archived %s -> %s", audio.name, target)


# --------------------------------------------------------------------------- #
# Manager
# --------------------------------------------------------------------------- #
class Manager:
    def __init__(self):
        from uploader import UploadManager
        from video_maker import VideoMaker

        self.queue = JobQueue()
        self.maker = VideoMaker()
        self.uploads = UploadManager()

    # ---- production ---------------------------------------------------- #
    def render_one(self, audio: Path, background: Path) -> dict:
        result = self.maker.make(audio, background)
        meta = generate_metadata(audio.stem, result.transcript)
        return {
            "id": uuid.uuid4().hex[:10],
            "audio": str(audio),
            "background": str(background),
            "video": str(result.video_path),
            "meta": meta.to_dict(),
            "created_at": _now().isoformat(),
            "scheduled_at": _now().isoformat(),
            "status": "pending",
            "platforms": {},
        }

    def produce_daily_batch(self) -> None:
        log.info("=== Producing daily batch of %d videos ===", config.VIDEOS_PER_DAY)
        batch_start = _now()
        inputs = pick_inputs(config.VIDEOS_PER_DAY, self.queue.reserved_audio())
        for index, (audio, background) in enumerate(inputs):
            try:
                job = self.render_one(audio, background)
            except Exception:  # noqa: BLE001
                log.exception("Rendering failed for %s", audio.name)
                continue
            offset = timedelta(
                minutes=config.FIRST_UPLOAD_DELAY_MINUTES
                + index * config.UPLOAD_INTERVAL_HOURS * 60
                + random.randint(-config.UPLOAD_JITTER_MINUTES, config.UPLOAD_JITTER_MINUTES)
            )
            job["scheduled_at"] = max(batch_start + offset, _now()).isoformat()
            self.queue.jobs.append(job)
            self.queue.save()  # persist after every render
            log.info("Queued %s for %s", Path(job["video"]).name, job["scheduled_at"])
        self.queue.data["last_batch_date"] = date.today().isoformat()
        self.queue.save()

    def ensure_todays_batch(self) -> None:
        if self.queue.data.get("last_batch_date") != date.today().isoformat():
            self.produce_daily_batch()

    # ---- publishing ---------------------------------------------------- #
    def _gap_ok(self) -> bool:
        last = self.queue.data.get("last_upload_at")
        if not last:
            return True
        return _now() - datetime.fromisoformat(last) >= timedelta(minutes=config.MIN_UPLOAD_GAP_MINUTES)

    def process_due_jobs(self) -> None:
        due = sorted((j for j in self.queue.pending()
                      if datetime.fromisoformat(j["scheduled_at"]) <= _now()),
                     key=lambda j: j["scheduled_at"])
        if not due:
            return
        if not self._gap_ok():
            log.debug("%d job(s) due but waiting for the minimum gap between uploads", len(due))
            return
        self.publish(due[0])  # one video per tick keeps uploads spaced out

    def publish(self, job: dict) -> None:
        video = Path(job["video"])
        if not video.exists():
            log.error("Video file missing for job %s: %s", job["id"], video)
            job["status"] = "failed"
            self.queue.save()
            return

        meta = VideoMetadata.from_dict(job["meta"])
        done = {p for p, r in job["platforms"].items() if r.get("ok")}
        exhausted = {p for p, r in job["platforms"].items()
                     if not r.get("ok") and r.get("attempts", 0) >= config.MAX_UPLOAD_ATTEMPTS}
        results = self.uploads.upload_all(video, meta, skip=done | exhausted)

        for platform, result in results.items():
            previous = job["platforms"].get(platform, {})
            result["attempts"] = previous.get("attempts", 0) + 1
            result["at"] = _now().isoformat()
            job["platforms"][platform] = result
        self.queue.data["last_upload_at"] = _now().isoformat()

        enabled = set(self.uploads.enabled_platforms)
        succeeded = {p for p in enabled if job["platforms"].get(p, {}).get("ok")}
        retryable = {p for p in enabled - succeeded
                     if job["platforms"].get(p, {}).get("attempts", 0) < config.MAX_UPLOAD_ATTEMPTS}

        if retryable:
            job["scheduled_at"] = (_now() + timedelta(minutes=config.RETRY_DELAY_MINUTES)).isoformat()
            log.warning("Job %s: retrying %s at %s", job["id"], sorted(retryable), job["scheduled_at"])
        elif succeeded:
            job["status"] = "done"
            failed = enabled - succeeded
            log.info("Job %s finished. OK: %s%s", job["id"], sorted(succeeded),
                     f" | gave up on: {sorted(failed)}" if failed else "")
            archive_audio(Path(job["audio"]))
            if config.DELETE_VIDEO_AFTER_UPLOAD:
                video.unlink(missing_ok=True)
        else:
            job["status"] = "failed"
            log.error("Job %s failed on every platform; audio kept for reuse", job["id"])
        self.queue.save()

    # ---- main loop ----------------------------------------------------- #
    def run_forever(self, batch_now: bool = False) -> None:
        stop = {"flag": False}

        def _stop(signum, _frame):
            log.info("Signal %s received, shutting down after current task...", signum)
            stop["flag"] = True

        signal.signal(signal.SIGINT, _stop)
        signal.signal(signal.SIGTERM, _stop)

        schedule.every().day.at(config.DAILY_RUN_TIME).do(self._safe, self.produce_daily_batch)
        schedule.every(1).minutes.do(self._safe, self.process_due_jobs)
        log.info("Scheduler started. Platforms: %s | daily batch at %s",
                 self.uploads.enabled_platforms or "none", config.DAILY_RUN_TIME)

        if batch_now:
            self._safe(self.produce_daily_batch)
        elif config.RUN_ON_START:
            self._safe(self.ensure_todays_batch)

        while not stop["flag"]:
            schedule.run_pending()
            time.sleep(20)

    @staticmethod
    def _safe(func) -> None:
        try:
            func()
        except Exception:  # noqa: BLE001 - the loop must never die
            log.exception("Scheduled task %s crashed", func.__name__)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def print_status() -> None:
    queue = JobQueue()
    print(f"Last batch: {queue.data.get('last_batch_date')} | last upload: {queue.data.get('last_upload_at')}")
    for job in queue.jobs[-30:]:
        platforms = ", ".join(f"{p}:{'ok' if r.get('ok') else 'x' + str(r.get('attempts', 0))}"
                              for p, r in job["platforms"].items()) or "-"
        print(f"{job['id']}  {job['status']:<8} {job['scheduled_at'][:16]}  "
              f"{Path(job['video']).name}  [{platforms}]")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Automated Shorts/Reels/TikTok generator & publisher")
    parser.add_argument("--once", action="store_true", help="render one video and upload it now")
    parser.add_argument("--render-only", type=int, metavar="N", help="render N videos without uploading")
    parser.add_argument("--batch-now", action="store_true", help="produce a batch now, then keep running")
    parser.add_argument("--status", action="store_true", help="print the upload queue")
    parser.add_argument("--auth", choices=["youtube", "tiktok", "meta"], help="run one-time auth flow")
    parser.add_argument("--token", help="short-lived Meta user token (with --auth meta)")
    args = parser.parse_args(argv)

    config.setup_logging()

    if args.status:
        print_status()
        return 0

    if args.auth:
        from uploader import TikTokUploader, YouTubeUploader, meta_token_helper

        if args.auth == "youtube":
            YouTubeUploader().authorize()
        elif args.auth == "tiktok":
            TikTokUploader().authorize()
        else:
            if not args.token:
                parser.error("--auth meta requires --token <SHORT_LIVED_USER_TOKEN>")
            meta_token_helper(args.token)
        return 0

    if args.render_only:
        from video_maker import VideoMaker

        maker = VideoMaker()
        for audio, background in pick_inputs(args.render_only, set()):
            result = maker.make(audio, background)
            meta = generate_metadata(audio.stem, result.transcript)
            print(f"\n{result.video_path}\nTitle: {meta.title}\n{meta.description}\n")
        return 0

    manager = Manager()
    if args.once:
        inputs = pick_inputs(1, manager.queue.reserved_audio())
        if not inputs:
            return 1
        job = manager.render_one(*inputs[0])
        manager.queue.jobs.append(job)
        manager.queue.save()
        manager.publish(job)
        print_status()
        return 0

    manager.run_forever(batch_now=args.batch_now)
    return 0


if __name__ == "__main__":
    sys.exit(main())
