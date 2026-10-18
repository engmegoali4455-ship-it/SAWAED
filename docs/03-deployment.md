# النشر

## 1. Supabase (الخادم)

1. **أنشئ مشروعاً** في supabase.com. المنطقة المقترحة: `eu-central-1`، أو الأقرب للرياض المتاح.
2. **فعّل الإضافتين** `pg_cron` و`pg_net` من Database ← Extensions.
3. **طبّق المخطط:**
   ```bash
   supabase link --project-ref <ref>
   supabase db push          # يطبّق المهاجرات الثماني
   psql "$DB_URL" -f supabase/seed.sql
   ```
4. **انشر الدوال وضع أسرارها:**
   ```bash
   supabase secrets set --env-file supabase/functions/.env   # انسخه من .env.example واملأه
   supabase functions deploy
   ```
5. **اربط الإشعارات بقاعدة البيانات.** يُنفَّذ مرة واحدة، والقيمة نفسها هي `PUSH_SECRET` في أسرار الدوال:
   ```sql
   insert into app_settings (key, value) values
     ('push_endpoint', '"https://<ref>.functions.supabase.co/dispatch-push"'),
     ('push_secret',   '"<نفس PUSH_SECRET>"')
   on conflict (key) do update set value = excluded.value;
   ```
6. **إعدادات Auth:**
   - Site URL = عنوان التطبيق.
   - أضف `https://<app>/account/` إلى Redirect URLs.
   - عطّل التسجيل الذاتي، لأن الحسابات بالدعوة فقط.
7. **استورد البيانات الحالية.** راجع [`04-operations.md`](04-operations.md).

### الأسرار المطلوبة

| السر | لماذا |
|---|---|
| `PUSH_SECRET` | يحمي `dispatch-push` و`weekly-email` |
| `APP_URL` | روابط الدعوات والبريد |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push. التوليد: `npx web-push generate-vapid-keys` |
| `FCM_SERVICE_ACCOUNT` | إشعارات أندرويد: JSON حساب خدمة Firebase في سطر واحد |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION` | إشعارات iOS: مفتاح `.p8` من Apple Developer |
| `RESEND_API_KEY`, `MAIL_FROM` | الملخص الأسبوعي بالبريد |

القناة التي لا تُضبط أسرارها تُتجاوز دون خطأ.

## 2. الويب (PWA للابتوب والمتصفح)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon> \
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<vapid public> \
npm run build      # يُخرج out/ ومعه sw.js
```

انشر مجلد `out/` على أي استضافة ثابتة تعمل بـ HTTPS، مثل Netlify أو Cloudflare Pages أو Vercel أو خادم الشركة.

- **الشرط الوحيد:** يُقدَّم `index.html` لكل مجلد (`/project/` ← `/project/index.html`)، وهو السلوك الافتراضي لهذه الاستضافات.
- **التثبيت على اللابتوب:** من Chrome أو Edge ← أيقونة التثبيت في شريط العنوان، فيعمل كبرنامج مستقل ودون اتصال.

## 3. أندرويد

```bash
npm run build && npx cap sync android
npx cap open android      # Android Studio ← Build ← Generate Signed Bundle / APK
```

- **إشعارات أندرويد:** ضع `google-services.json` من مشروع Firebase في `android/app/`.
- **البناء الآلي:** سير العمل `release.yml` يبني APK وAAB موقّعين عند وسم `v*`. أسراره:
  - `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
  - `GOOGLE_SERVICES_JSON`
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY`
- **التوزيع:** Google Play (Internal testing)، أو داخلياً بملف APK.

## 4. iOS (يتطلب Mac وحساب Apple Developer)

```bash
npm run build && npx cap sync ios
npx cap open ios          # Xcode ← Signing & Capabilities: الفريق + Push Notifications
```

- **الرفع:** Product ← Archive ← TestFlight.
- **التوزيع الداخلي:** Apple Business Manager (Custom App) أو TestFlight.
- **CI:** سير العمل يتحقق من بناء المحاكي دون توقيع. التوقيع للمتجر يتم من Xcode أو بإضافة fastlane match.

## 5. سطح المكتب (ملف تثبيت)

```bash
npm run build
npx tauri build           # Windows: .msi و .exe — macOS: .dmg و .app — Linux: .deb و .AppImage
```

`release.yml` يبني نسخ Windows وmacOS (universal) ويرفقها بمسودة إصدار في GitHub.

- **macOS:** لنسخة موقّعة ومُوثّقة (notarized) أضف أسرار Apple لـ tauri-action.
- **Windows:** بلا شهادة توقيع سيظهر تحذير SmartScreen عند أول تشغيل.

## 6. خط النشر الآلي

| سير العمل | متى | ماذا |
|---|---|---|
| `ci.yml` | كل دفع وطلب دمج | فحص الأنواع، واختبارات الوحدات، والبناء، واختبارات قاعدة البيانات. ثم E2E على Supabase محلي: الاستيراد، والمزامنة، وسيناريو القبول مع PDF، و360px |
| `release.yml` | وسم `v*` | PWA (zip)، وأندرويد، وتحقق iOS، وسطح المكتب |
| `deploy-backend.yml` | دمج في `main` يمس `supabase/` | `db push` ثم نشر الدوال. الأسرار: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` |
