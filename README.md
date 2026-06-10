# Shul

אפליקציית דסקטופ (Windows) לתמלול ותרגום אוטומטי של סרטונים לעברית, למשתמשים לא טכנולוגיים.

מקבלת קובצי וידאו (MOV / MP4 / MKV ועוד), מתמללת אותם מקומית, מתרגמת לעברית, ומפיקה כתוביות כקובץ נפרד או צרובות על הווידאו - או רק ממירה ל-MP4.

## הורדה

קובץ ההתקנה המוכן נמצא תחת [Releases](../../releases) - `Shul-Setup-1.0.0.exe`.
זו התקנה עצמאית (standalone) שמתקינה את כל התלויות לבד. בהפעלה ראשונה ייתכן ש-Windows SmartScreen
יבקש "More info" → "Run anyway" (הקובץ אינו חתום דיגיטלית).

## יכולות

- **תמלול מקומי** באמצעות מנוע Parakeet (ONNX, CPU, offline) - לא נשלח מידע לאינטרנט
- **תרגום לעברית** דרך Claude CLI אם מותקן במחשב; אחרת כתוביות באנגלית בלבד (זיהוי אוטומטי)
- **פלט גמיש**: קובץ כתוביות SRT, צריבה על הווידאו (RTL נכון), או המרה ל-MP4
- **תור עיבוד** עם התקדמות אמיתית, עצירה/המשך לכל קובץ, ומטמון תרגום

## ארכיטקטורה

- Electron (main / preload / renderer)
- `src/main/pipeline.js` - תזמור הצינור לכל קובץ
- `src/main/whisper.js` + `src/main/python/parakeet.py` - תמלול אנגלית (Parakeet)
- `src/main/whisper-he.js` + `src/main/whisper-model.js` - תמלול עברית (whisper.cpp + ivrit.ai, מודל בהורדה לפי דרישה)
- `src/main/translate.js` - תרגום עם Claude + מטמון
- `src/main/srt.js` - בניית כתוביות, מיזוג, ו-RTL
- `src/main/ffmpeg.js` - המרה / חילוץ שמע / צריבה
- `src/main/updater.js` - עדכון אוטומטי דרך GitHub Releases

## בנייה מהמקור (Build from source)

The large binaries are **not** stored in git (they exceed GitHub's 100 MB file limit). To build
the installer you need to place them in:

- `resources/bin/` - `ffmpeg.exe`, `ffprobe.exe` (static Windows builds)
- `resources/model/` - the Parakeet `nemo-parakeet-tdt-0.6b-v2` ONNX int8 files
- `resources/whisper/` - whisper.cpp CPU binaries (`whisper-cli.exe` + ggml/whisper DLLs)
- `build_pyi/dist/parakeet/` - the PyInstaller one-dir build of `parakeet.py`

The Hebrew model (ivrit.ai ggml) is **not** bundled - it is downloaded on demand at runtime.

Then:

```
npm install
npx electron-builder --win --x64
```

The installer is written to `dist/Shul-Setup-<version>.exe`.
