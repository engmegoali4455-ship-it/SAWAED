"""The Uploader: publishes a rendered video to YouTube, Facebook, Instagram and TikTok.

Each platform is a small class with the same interface::

    uploader.upload(video_path, metadata) -> str   # returns the platform's post/video id

Failures raise ``UploadError``; ``UploadManager`` catches them per platform so one
broken integration never blocks the others.
"""
from __future__ import annotations

import json
import logging
import secrets
import time
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import requests

import config
from metadata import VideoMetadata

log = logging.getLogger(__name__)


class UploadError(RuntimeError):
    """Raised when an upload fails for a given platform."""


# --------------------------------------------------------------------------- #
# HTTP helpers
# --------------------------------------------------------------------------- #
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


def _request(method: str, url: str, *, retries: int = 3, timeout: int | None = None,
             **kwargs) -> requests.Response:
    """requests wrapper with retry on network errors / 5xx / 429."""
    timeout = timeout or config.HTTP_TIMEOUT
    for attempt in range(1, retries + 1):
        try:
            response = requests.request(method, url, timeout=timeout, **kwargs)
        except (requests.ConnectionError, requests.Timeout) as exc:
            if attempt == retries:
                raise UploadError(f"{method} {url} failed: {exc}") from exc
            log.warning("Network error on %s (attempt %d/%d): %s", url, attempt, retries, exc)
        else:
            if response.status_code not in RETRYABLE_STATUS or attempt == retries:
                return response
            log.warning("HTTP %s on %s (attempt %d/%d)", response.status_code, url, attempt, retries)
        time.sleep(2 ** attempt)
        # rewind file bodies before retrying
        body = kwargs.get("data")
        if hasattr(body, "seek"):
            body.seek(0)
    raise UploadError(f"{method} {url} failed after {retries} attempts")


def _json(response: requests.Response, context: str) -> dict:
    try:
        payload = response.json()
    except ValueError:
        payload = {"raw": response.text[:500]}
    error = payload.get("error")
    api_error = isinstance(error, dict) and error.get("code") not in (None, "ok")
    if not response.ok or api_error:
        raise UploadError(f"{context}: HTTP {response.status_code} {json.dumps(payload)[:800]}")
    return payload


# --------------------------------------------------------------------------- #
# Base class
# --------------------------------------------------------------------------- #
class BaseUploader:
    name = "base"

    @property
    def enabled(self) -> bool:
        raise NotImplementedError

    def upload(self, video_path: Path, meta: VideoMetadata) -> str:
        raise NotImplementedError


# --------------------------------------------------------------------------- #
# YouTube Shorts (YouTube Data API v3, OAuth 2.0)
# --------------------------------------------------------------------------- #
class YouTubeUploader(BaseUploader):
    name = "youtube"
    SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

    @property
    def enabled(self) -> bool:
        return config.ENABLE_YOUTUBE

    def _credentials(self, interactive: bool = False):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow

        token_file = config.YOUTUBE_TOKEN_FILE
        creds = None
        if token_file.exists():
            creds = Credentials.from_authorized_user_file(str(token_file), self.SCOPES)

        if creds and creds.valid:
            return creds
        if creds and creds.expired and creds.refresh_token:
            log.info("Refreshing YouTube access token")
            creds.refresh(Request())
        elif interactive:
            if not config.YOUTUBE_CLIENT_SECRETS_FILE.exists():
                raise UploadError(f"Missing {config.YOUTUBE_CLIENT_SECRETS_FILE}")
            flow = InstalledAppFlow.from_client_secrets_file(
                str(config.YOUTUBE_CLIENT_SECRETS_FILE), self.SCOPES
            )
            creds = flow.run_local_server(port=0, open_browser=True,
                                          access_type="offline", prompt="consent")
        else:
            raise UploadError("YouTube is not authorised. Run: python main.py --auth youtube")

        token_file.parent.mkdir(parents=True, exist_ok=True)
        token_file.write_text(creds.to_json(), encoding="utf-8")
        return creds

    def authorize(self) -> None:
        self._credentials(interactive=True)
        log.info("YouTube authorised; token saved to %s", config.YOUTUBE_TOKEN_FILE)

    def upload(self, video_path: Path, meta: VideoMetadata) -> str:
        from googleapiclient.discovery import build
        from googleapiclient.errors import HttpError
        from googleapiclient.http import MediaFileUpload

        youtube = build("youtube", "v3", credentials=self._credentials(), cache_discovery=False)
        body = {
            "snippet": {
                "title": meta.title,
                "description": meta.description,
                "tags": meta.tags,
                "categoryId": config.YOUTUBE_CATEGORY_ID,
            },
            "status": {
                "privacyStatus": config.YOUTUBE_PRIVACY,
                "selfDeclaredMadeForKids": False,
            },
        }
        media = MediaFileUpload(str(video_path), mimetype="video/mp4",
                                chunksize=8 * 1024 * 1024, resumable=True)
        request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

        response, retries = None, 0
        while response is None:
            try:
                status, response = request.next_chunk()
                if status:
                    log.debug("YouTube upload %d%%", int(status.progress() * 100))
            except HttpError as exc:
                if exc.resp.status in RETRYABLE_STATUS and retries < 5:
                    retries += 1
                    log.warning("YouTube HTTP %s, retry %d", exc.resp.status, retries)
                    time.sleep(2 ** retries)
                    continue
                raise UploadError(f"YouTube upload failed: {exc}") from exc
            except (ConnectionError, TimeoutError) as exc:
                if retries >= 5:
                    raise UploadError(f"YouTube upload failed: {exc}") from exc
                retries += 1
                time.sleep(2 ** retries)

        video_id = response["id"]
        log.info("YouTube: uploaded https://youtube.com/shorts/%s", video_id)
        return video_id


# --------------------------------------------------------------------------- #
# Meta Graph API shared bits
# --------------------------------------------------------------------------- #
def _graph(path: str) -> str:
    return f"https://graph.facebook.com/{config.META_GRAPH_VERSION}/{path.lstrip('/')}"


def _rupload(url: str, token: str, video_path: Path) -> dict:
    """Binary upload to Meta's rupload.facebook.com endpoint (single request)."""
    size = video_path.stat().st_size
    headers = {"Authorization": f"OAuth {token}", "offset": "0", "file_size": str(size)}
    with open(video_path, "rb") as fh:
        response = _request("POST", url, headers=headers, data=fh, timeout=config.UPLOAD_TIMEOUT)
    return _json(response, "Meta binary upload")


# --------------------------------------------------------------------------- #
# Facebook Reels (Page)
# --------------------------------------------------------------------------- #
class FacebookReelsUploader(BaseUploader):
    name = "facebook"

    @property
    def enabled(self) -> bool:
        return config.ENABLE_FACEBOOK

    def upload(self, video_path: Path, meta: VideoMetadata) -> str:
        page_id, token = config.FACEBOOK_PAGE_ID, config.FACEBOOK_PAGE_ACCESS_TOKEN
        if not page_id or not token:
            raise UploadError("FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN not set")
        endpoint = _graph(f"{page_id}/video_reels")

        # 1) start an upload session
        start = _json(_request("POST", endpoint, data={"upload_phase": "start", "access_token": token}),
                      "Facebook reels start")
        video_id = start["video_id"]
        upload_url = start.get("upload_url") or \
            f"https://rupload.facebook.com/video-upload/{config.META_GRAPH_VERSION}/{video_id}"

        # 2) upload the bytes
        result = _rupload(upload_url, token, video_path)
        if not result.get("success", False):
            raise UploadError(f"Facebook binary upload not successful: {result}")

        # 3) finish + publish
        _json(_request("POST", endpoint, data={
            "upload_phase": "finish",
            "video_id": video_id,
            "video_state": "PUBLISHED",
            "description": meta.caption,
            "access_token": token,
        }), "Facebook reels finish")

        self._wait_until_published(video_id, token)
        log.info("Facebook: published reel %s", video_id)
        return video_id

    def _wait_until_published(self, video_id: str, token: str) -> None:
        deadline = time.time() + config.PROCESSING_TIMEOUT
        while time.time() < deadline:
            payload = _json(_request("GET", _graph(video_id),
                                     params={"fields": "status", "access_token": token}),
                            "Facebook reel status")
            status = payload.get("status", {})
            video_status = status.get("video_status")
            publishing = status.get("publishing_phase", {}).get("status")
            if video_status == "error" or publishing == "error":
                raise UploadError(f"Facebook processing error: {status}")
            if publishing == "complete" or video_status == "ready":
                return
            time.sleep(10)
        log.warning("Facebook reel %s still processing after timeout; it will publish when ready.",
                    video_id)


# --------------------------------------------------------------------------- #
# Instagram Reels (Instagram Graph API via Facebook Login)
# --------------------------------------------------------------------------- #
class InstagramReelsUploader(BaseUploader):
    name = "instagram"

    @property
    def enabled(self) -> bool:
        return config.ENABLE_INSTAGRAM

    def upload(self, video_path: Path, meta: VideoMetadata) -> str:
        ig_id, token = config.INSTAGRAM_USER_ID, config.INSTAGRAM_ACCESS_TOKEN
        if not ig_id or not token:
            raise UploadError("INSTAGRAM_USER_ID / INSTAGRAM_ACCESS_TOKEN not set")

        # 1) create a resumable REELS container
        container = _json(_request("POST", _graph(f"{ig_id}/media"), data={
            "media_type": "REELS",
            "upload_type": "resumable",
            "caption": meta.caption[:2200],
            "share_to_feed": str(config.INSTAGRAM_SHARE_TO_FEED).lower(),
            "access_token": token,
        }), "Instagram container create")
        container_id = container["id"]
        upload_uri = container.get("uri") or \
            f"https://rupload.facebook.com/ig-api-upload/{config.META_GRAPH_VERSION}/{container_id}"

        # 2) upload the bytes
        result = _rupload(upload_uri, token, video_path)
        if not result.get("success", True):
            raise UploadError(f"Instagram binary upload not successful: {result}")

        # 3) wait for Instagram to process the video
        self._wait_until_ready(container_id, token)

        # 4) publish
        published = _json(_request("POST", _graph(f"{ig_id}/media_publish"), data={
            "creation_id": container_id, "access_token": token,
        }), "Instagram publish")
        media_id = published["id"]
        log.info("Instagram: published reel %s", media_id)
        return media_id

    def _wait_until_ready(self, container_id: str, token: str) -> None:
        deadline = time.time() + config.PROCESSING_TIMEOUT
        while time.time() < deadline:
            payload = _json(_request("GET", _graph(container_id), params={
                "fields": "status_code,status", "access_token": token,
            }), "Instagram container status")
            code = payload.get("status_code")
            if code == "FINISHED":
                return
            if code in {"ERROR", "EXPIRED"}:
                raise UploadError(f"Instagram processing failed: {payload}")
            time.sleep(10)
        raise UploadError("Instagram processing timed out")


# --------------------------------------------------------------------------- #
# TikTok (Content Posting API)
# --------------------------------------------------------------------------- #
class TikTokUploader(BaseUploader):
    name = "tiktok"
    API = "https://open.tiktokapis.com/v2"
    AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/"
    SCOPES = "user.info.basic,video.upload,video.publish"
    MIN_CHUNK = 5 * 1024 * 1024
    MAX_CHUNK = 64 * 1024 * 1024
    CHUNK = 10 * 1024 * 1024

    @property
    def enabled(self) -> bool:
        return config.ENABLE_TIKTOK

    # ---- token storage / refresh ------------------------------------------ #
    def _load_tokens(self) -> dict:
        if config.TIKTOK_TOKEN_FILE.exists():
            return json.loads(config.TIKTOK_TOKEN_FILE.read_text(encoding="utf-8"))
        return {
            "access_token": config.TIKTOK_ACCESS_TOKEN,
            "refresh_token": config.TIKTOK_REFRESH_TOKEN,
            "expires_at": 0,  # unknown -> refresh on first use if we can
        }

    def _save_tokens(self, payload: dict) -> dict:
        tokens = {
            "access_token": payload["access_token"],
            "refresh_token": payload.get("refresh_token", ""),
            "expires_at": time.time() + int(payload.get("expires_in", 86400)) - 300,
            "open_id": payload.get("open_id", ""),
        }
        config.TIKTOK_TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        config.TIKTOK_TOKEN_FILE.write_text(json.dumps(tokens, indent=2), encoding="utf-8")
        return tokens

    def _token_request(self, data: dict) -> dict:
        data = {"client_key": config.TIKTOK_CLIENT_KEY,
                "client_secret": config.TIKTOK_CLIENT_SECRET, **data}
        response = _request("POST", f"{self.API}/oauth/token/", data=data,
                            headers={"Content-Type": "application/x-www-form-urlencoded"})
        payload = _json(response, "TikTok token")
        if "access_token" not in payload:
            raise UploadError(f"TikTok token error: {payload}")
        return self._save_tokens(payload)

    def _access_token(self, force_refresh: bool = False) -> str:
        tokens = self._load_tokens()
        expired = time.time() >= tokens.get("expires_at", 0)
        if (expired or force_refresh) and tokens.get("refresh_token") and config.TIKTOK_CLIENT_KEY:
            log.info("Refreshing TikTok access token")
            tokens = self._token_request({"grant_type": "refresh_token",
                                          "refresh_token": tokens["refresh_token"]})
        if not tokens.get("access_token"):
            raise UploadError("TikTok is not authorised. Run: python main.py --auth tiktok")
        return tokens["access_token"]

    def authorize(self) -> None:
        """One-time OAuth: open URL, approve, paste the redirected URL back."""
        if not (config.TIKTOK_CLIENT_KEY and config.TIKTOK_CLIENT_SECRET and config.TIKTOK_REDIRECT_URI):
            raise UploadError("Set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and TIKTOK_REDIRECT_URI first")
        state = secrets.token_urlsafe(16)
        url = f"{self.AUTH_URL}?" + urlencode({
            "client_key": config.TIKTOK_CLIENT_KEY,
            "scope": self.SCOPES,
            "response_type": "code",
            "redirect_uri": config.TIKTOK_REDIRECT_URI,
            "state": state,
        })
        print("\n1) Open this URL, log in and approve the app:\n\n" + url)
        redirected = input("\n2) Paste the FULL URL you were redirected to:\n> ").strip()
        query = parse_qs(urlparse(redirected).query)
        if query.get("state", [""])[0] != state:
            raise UploadError("State mismatch - please retry the authorisation")
        code = query.get("code", [""])[0]
        if not code:
            raise UploadError(f"No code in redirect URL: {query}")
        self._token_request({"grant_type": "authorization_code", "code": code,
                             "redirect_uri": config.TIKTOK_REDIRECT_URI})
        log.info("TikTok authorised; tokens saved to %s", config.TIKTOK_TOKEN_FILE)

    # ---- API calls --------------------------------------------------------- #
    def _post(self, path: str, body: dict, token: str) -> dict:
        response = _request("POST", f"{self.API}{path}", json=body, headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=UTF-8",
        })
        return _json(response, f"TikTok {path}")

    def _privacy_level(self, token: str) -> str:
        info = self._post("/post/publish/creator_info/query/", {}, token).get("data", {})
        options = info.get("privacy_level_options") or []
        wanted = config.TIKTOK_PRIVACY_LEVEL
        if options and wanted not in options:
            log.warning("TikTok privacy %s not allowed (options: %s); using %s",
                        wanted, options, options[-1])
            return options[-1]
        return wanted

    def _chunking(self, size: int) -> tuple[int, int]:
        if size <= self.MAX_CHUNK:
            return size, 1  # whole file in one request
        chunk = self.CHUNK
        return chunk, size // chunk  # last chunk absorbs the remainder

    def upload(self, video_path: Path, meta: VideoMetadata) -> str:
        token = self._access_token()
        size = video_path.stat().st_size
        chunk_size, chunk_count = self._chunking(size)
        source_info = {"source": "FILE_UPLOAD", "video_size": size,
                       "chunk_size": chunk_size, "total_chunk_count": chunk_count}

        if config.TIKTOK_POST_MODE == "inbox":
            # Sends to the creator's TikTok inbox as a draft to finish in-app.
            init = self._post("/post/publish/inbox/video/init/", {"source_info": source_info}, token)
        else:
            init = self._post("/post/publish/video/init/", {
                "post_info": {
                    "title": meta.caption[:2200],
                    "privacy_level": self._privacy_level(token),
                    "disable_duet": False,
                    "disable_comment": False,
                    "disable_stitch": False,
                    "video_cover_timestamp_ms": 1000,
                },
                "source_info": source_info,
            }, token)

        publish_id = init["data"]["publish_id"]
        upload_url = init["data"]["upload_url"]
        self._upload_chunks(upload_url, video_path, size, chunk_size, chunk_count)
        self._wait_for_status(publish_id, token)
        log.info("TikTok: %s complete (publish_id=%s)", config.TIKTOK_POST_MODE, publish_id)
        return publish_id

    def _upload_chunks(self, url: str, path: Path, size: int, chunk_size: int, count: int) -> None:
        with open(path, "rb") as fh:
            for index in range(count):
                start = index * chunk_size
                end = size - 1 if index == count - 1 else start + chunk_size - 1
                fh.seek(start)
                data = fh.read(end - start + 1)
                response = _request("PUT", url, data=data, timeout=config.UPLOAD_TIMEOUT, headers={
                    "Content-Type": "video/mp4",
                    "Content-Length": str(len(data)),
                    "Content-Range": f"bytes {start}-{end}/{size}",
                })
                if response.status_code not in (200, 201, 206):
                    raise UploadError(f"TikTok chunk {index + 1}/{count} failed: "
                                      f"HTTP {response.status_code} {response.text[:300]}")
                log.debug("TikTok chunk %d/%d uploaded", index + 1, count)

    def _wait_for_status(self, publish_id: str, token: str) -> None:
        deadline = time.time() + config.PROCESSING_TIMEOUT
        done = {"PUBLISH_COMPLETE", "SEND_TO_USER_INBOX"}
        while time.time() < deadline:
            data = self._post("/post/publish/status/fetch/", {"publish_id": publish_id}, token)["data"]
            status = data.get("status")
            if status in done:
                return
            if status == "FAILED":
                raise UploadError(f"TikTok publish failed: {data.get('fail_reason')}")
            time.sleep(10)
        log.warning("TikTok publish %s still processing after timeout", publish_id)


# --------------------------------------------------------------------------- #
# Manager
# --------------------------------------------------------------------------- #
class UploadManager:
    def __init__(self, uploaders: list[BaseUploader] | None = None):
        self.uploaders = uploaders or [
            YouTubeUploader(), FacebookReelsUploader(), InstagramReelsUploader(), TikTokUploader(),
        ]

    @property
    def enabled_platforms(self) -> list[str]:
        return [u.name for u in self.uploaders if u.enabled]

    def upload(self, platform: str, video_path: Path, meta: VideoMetadata) -> str:
        uploader = next(u for u in self.uploaders if u.name == platform)
        return uploader.upload(video_path, meta)

    def upload_all(self, video_path: Path, meta: VideoMetadata,
                   skip: set[str] | None = None) -> dict[str, dict]:
        """Upload to every enabled platform; returns {platform: {ok, id|error}}."""
        results: dict[str, dict] = {}
        for uploader in self.uploaders:
            if not uploader.enabled or uploader.name in (skip or set()):
                continue
            log.info("Uploading %s to %s...", video_path.name, uploader.name)
            try:
                post_id = uploader.upload(video_path, meta)
                results[uploader.name] = {"ok": True, "id": post_id}
            except UploadError as exc:
                log.error("%s upload failed: %s", uploader.name, exc)
                results[uploader.name] = {"ok": False, "error": str(exc)[:1000]}
            except Exception as exc:  # noqa: BLE001 - one platform must not break others
                log.exception("%s upload failed", uploader.name)
                results[uploader.name] = {"ok": False, "error": str(exc)[:1000]}
        return results


# --------------------------------------------------------------------------- #
# Meta token helper
# --------------------------------------------------------------------------- #
def meta_token_helper(short_lived_user_token: str) -> None:
    """Exchange a short-lived user token for a never-expiring Page token and
    print the Page ID + linked Instagram professional account ID."""
    if not (config.META_APP_ID and config.META_APP_SECRET):
        raise UploadError("Set META_APP_ID and META_APP_SECRET in .env first")
    long_lived = _json(_request("GET", _graph("oauth/access_token"), params={
        "grant_type": "fb_exchange_token",
        "client_id": config.META_APP_ID,
        "client_secret": config.META_APP_SECRET,
        "fb_exchange_token": short_lived_user_token,
    }), "Meta token exchange")["access_token"]

    pages = _json(_request("GET", _graph("me/accounts"), params={
        "fields": "id,name,access_token,instagram_business_account",
        "access_token": long_lived,
    }), "Meta list pages").get("data", [])
    if not pages:
        print("No Pages found for this user. Make sure you granted pages_* permissions.")
    for page in pages:
        ig = (page.get("instagram_business_account") or {}).get("id", "(no linked IG account)")
        print(f"\nPage: {page['name']}\n  FACEBOOK_PAGE_ID={page['id']}\n"
              f"  FACEBOOK_PAGE_ACCESS_TOKEN={page['access_token']}\n  INSTAGRAM_USER_ID={ig}")
    print("\nCopy the values for your Page into .env "
          "(INSTAGRAM_ACCESS_TOKEN can be left empty to reuse the Page token).")


__all__ = [
    "UploadError", "UploadManager", "YouTubeUploader", "FacebookReelsUploader",
    "InstagramReelsUploader", "TikTokUploader", "meta_token_helper",
]
