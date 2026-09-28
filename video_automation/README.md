# Social Video Automation (Shorts / Reels / TikTok)

Generates 5 vertical lyric videos a day from your own MP3s and uploads them, spaced a few
hours apart, to YouTube Shorts, Facebook Reels, Instagram Reels and TikTok.

```
video_automation/
├── main.py           # The Manager: scheduler, persistent queue, CLI
├── video_maker.py    # The Maker: Whisper transcription + kinetic typography + MoviePy render
├── uploader.py       # The Uploader: YouTube / Facebook / Instagram / TikTok
├── metadata.py       # Auto titles, descriptions, hashtags
├── config.py         # All settings, read from .env
├── requirements.txt
├── .env.example
├── fonts/            # put an Arabic .ttf here (Cairo-Bold.ttf, Tajawal-Bold.ttf, ...)
└── input/
    ├── audio/        # your MP3s (moved to archive/ after a successful upload)
    └── backgrounds/  # vertical MP4s or JPG/PNG images
```

## How it works

1. Every day at `DAILY_RUN_TIME` the manager picks 5 random unused audio files and 5
   random backgrounds.
2. For each pair: Whisper transcribes the song with word-level timestamps, then the words
   are drawn onto the background as they are sung (current word highlighted, Arabic shaped
   and right-to-left). The video is trimmed to `MAX_DURATION` (59 s) and saved to `output/`.
3. The videos are queued in `state/queue.json` with upload times spaced
   `UPLOAD_INTERVAL_HOURS` apart (± random jitter), and never less than
   `MIN_UPLOAD_GAP_MINUTES` apart.
4. When a video's time comes it is uploaded to every enabled platform. A platform that fails
   is retried later (`MAX_UPLOAD_ATTEMPTS`). Once the job is finished and at least one
   platform succeeded, the source audio is moved to `archive/` so it is never reused.

The queue is saved to disk, so you can stop and restart the script at any time.

## Installation

Requirements: Python 3.10+ and **FFmpeg** on your PATH (Whisper needs it).

```bash
# Ubuntu/Debian: sudo apt install ffmpeg      macOS: brew install ffmpeg
# Windows: winget install ffmpeg
cd video_automation
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt      # for an NVIDIA GPU install the CUDA build of torch first
cp .env.example .env                 # then edit .env
```

Download an Arabic font, e.g. [Cairo](https://fonts.google.com/specimen/Cairo) or
[Tajawal](https://fonts.google.com/specimen/Tajawal), and put the `.ttf` file in `fonts/`
(the default `FONT_PATH` is `fonts/Cairo-Bold.ttf`).

## Running

```bash
python main.py --render-only 1       # 1. test rendering only (no upload, nothing archived)
python main.py --auth youtube        # 2. one-time authorisations (see guide below)
python main.py --auth tiktok
python main.py --auth meta --token <SHORT_LIVED_USER_TOKEN>
python main.py --once                # 3. render one video and upload it right now
python main.py                       # 4. run forever
python main.py --status              # see the queue and per-platform results
```

To keep it running 24/7 on a Linux server, use a systemd service, `tmux`, or `pm2`.
Example `/etc/systemd/system/shorts-bot.service`:

```ini
[Unit]
Description=Shorts automation
After=network-online.target

[Service]
WorkingDirectory=/opt/video_automation
ExecStart=/opt/video_automation/.venv/bin/python main.py
Restart=always
User=youruser

[Install]
WantedBy=multi-user.target
```

Logs are written to `logs/automation.log` (rotated).

---

## Developer app setup guide

### 1. YouTube (Google Cloud Console)

1. Go to <https://console.cloud.google.com/> → create a new project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, fill in app name and emails.
   - Scopes: add `https://www.googleapis.com/auth/youtube.upload`.
   - **Test users**: add the Google account that owns the YouTube channel.
   - Set **Publishing status → In production**. In "Testing", refresh tokens expire
     after 7 days, so the bot would stop uploading every week.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**.
   Download the JSON and save it as `video_automation/client_secret.json`.
5. Run `python main.py --auth youtube`. A browser opens: sign in with the channel
   account and approve. The token is saved to `state/youtube_token.json` and refreshes
   itself from then on.
   - On a headless server: run this step on your PC, then copy `state/youtube_token.json`
     to the server.
6. Quota: an upload costs about 1,600 units out of the default 10,000/day, so 5 uploads a day
   fits. Videos uploaded by **unverified** API projects are locked to *private* until the
   project passes Google's
   [API compliance audit](https://support.google.com/youtube/contact/yt_api_form). Apply for it
   if you need public uploads.

### 2. Facebook Reels + Instagram Reels (Meta for Developers)

Before you start: you need a **Facebook Page**, and an **Instagram Business or Creator
account** linked to that Page (Instagram app → Settings → Account type; then link it in
the Page settings or in Meta Business Suite).

1. Go to <https://developers.facebook.com/apps> → **Create app** → use case
   *"Other"* → type **Business**. Connect it to your Business portfolio if asked.
2. Add products: **Facebook Login for Business** and **Instagram** (the "API setup with
   Facebook login" option).
3. **App settings → Basic**: copy **App ID** and **App Secret** into `.env`
   (`META_APP_ID`, `META_APP_SECRET`).
4. Open the **Graph API Explorer** (<https://developers.facebook.com/tools/explorer>):
   - Select your app, then **User Token**, and add these permissions:
     `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
     `business_management`, `instagram_basic`, `instagram_content_publish`.
   - Click **Generate Access Token** and approve for your Page and Instagram account.
5. Copy that short-lived token and run:
   ```bash
   python main.py --auth meta --token <THE_TOKEN>
   ```
   This prints `FACEBOOK_PAGE_ID`, a long-lived `FACEBOOK_PAGE_ACCESS_TOKEN` (Page tokens
   made from a long-lived user token don't expire) and `INSTAGRAM_USER_ID`. Paste them
   into `.env`.
6. While the app is in **Development** mode it can only post to Pages and IG accounts
   whose owners have a role on the app, which is enough for your own accounts. To manage
   other people's accounts you need **App Review** for the permissions above, plus
   Business Verification.

### 3. TikTok (TikTok for Developers)

1. Go to <https://developers.tiktok.com/> → log in → **Manage apps → Connect an app**.
2. Fill in the app details (icon, description, Terms of Service URL and Privacy Policy URL
   are required; any page on your website works).
3. **Add products**: **Login Kit** and **Content Posting API**.
   - In Content Posting API, enable **Direct Post**.
   - In Login Kit, add a **Redirect URI** (must be `https://`, e.g.
     `https://your-domain.com/tiktok/callback`; the page doesn't have to do anything).
4. **Scopes**: `user.info.basic`, `video.upload`, `video.publish`.
5. Copy **Client key** and **Client secret** into `.env`, and set `TIKTOK_REDIRECT_URI`
   to the exact URI from step 3.
6. **Sandbox**: add your TikTok account as a *target user*. Before submitting for review,
   test inside the sandbox.
7. Run `python main.py --auth tiktok`, open the printed URL, approve, then paste the
   full URL you were redirected to (it contains `?code=...`). Tokens are saved to
   `state/tiktok_token.json`. The access token (24 h) is refreshed automatically with the
   refresh token (valid 365 days).
8. **Important:** until your app passes TikTok's audit, every Direct Post is forced to
   **private (`SELF_ONLY`)**. Keep `TIKTOK_PRIVACY_LEVEL=SELF_ONLY` until then, or use
   `TIKTOK_POST_MODE=inbox` to send each video to your TikTok inbox as a draft you publish
   by hand. Submit the app for review to post publicly (`PUBLIC_TO_EVERYONE`).

---

## Tips and warnings

- **Copyright:** uploading commercial songs you don't own will get videos muted, blocked
  or cause copyright strikes. Use music you own or have licensed.
- **Speed:** Whisper `small` on CPU takes about 1–2 minutes per song. `medium`/`large-v3` are more
  accurate for Arabic lyrics but much slower without a GPU.
- Singing is harder to transcribe than speech. If lyrics come out wrong, try a bigger
  model or set `WHISPER_LANGUAGE` explicitly.
- Posting the same content across platforms on a fixed timetable can still look automated.
  Keep the jitter, and don't lower `MIN_UPLOAD_GAP_MINUTES` too much.
