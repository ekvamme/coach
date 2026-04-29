#!/usr/bin/env python3
"""
Picks up coach-*.m4a / coach-*.webm files dropped into ~/Downloads (via AirDrop
from the PWA), transcribes them with whisper.cpp, and stores transcripts in
./inbox/transcripts/ for Claude Code to read and log.

Usage:
    python3 process_inbox.py            # process new files in ~/Downloads
    python3 process_inbox.py --list     # show queued transcripts
    python3 process_inbox.py --print    # print all transcripts
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent
DOWNLOADS = Path.home() / "Downloads"
INBOX_AUDIO = ROOT / "inbox" / "audio"
INBOX_TRANSCRIPTS = ROOT / "inbox" / "transcripts"
MODEL = ROOT / "models" / "ggml-small.en.bin"
WHISPER = shutil.which("whisper-cli")
FFMPEG = shutil.which("ffmpeg")

AUDIO_EXTS = (".m4a", ".webm", ".mp4", ".wav")


def die(msg, code=2):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def find_new_audio():
    """coach-* files in Downloads that haven't been processed yet."""
    if not DOWNLOADS.exists():
        return []
    out = []
    for p in DOWNLOADS.iterdir():
        if not p.is_file():
            continue
        if not p.name.startswith("coach-"):
            continue
        if p.suffix.lower() not in AUDIO_EXTS:
            continue
        out.append(p)
    return sorted(out)


def to_wav16k(src: Path, dst: Path):
    """whisper.cpp wants 16 kHz mono PCM wav."""
    cmd = [FFMPEG, "-y", "-i", str(src), "-ar", "16000", "-ac", "1", "-f", "wav", str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {r.stderr.strip()[-400:]}")


def transcribe(wav: Path) -> str:
    cmd = [WHISPER, "-m", str(MODEL), "-f", str(wav), "-otxt", "-of", str(wav.with_suffix(""))]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"whisper-cli failed: {r.stderr.strip()[-400:]}")
    txt_path = wav.with_suffix(".txt")
    if not txt_path.exists():
        raise RuntimeError("whisper produced no .txt output")
    text = txt_path.read_text().strip()
    txt_path.unlink()
    return text


def process_one(src: Path):
    INBOX_AUDIO.mkdir(parents=True, exist_ok=True)
    INBOX_TRANSCRIPTS.mkdir(parents=True, exist_ok=True)

    base = src.stem  # e.g. coach-20260428-1430
    audio_dst = INBOX_AUDIO / src.name
    wav_tmp = INBOX_AUDIO / (base + ".wav")
    transcript_path = INBOX_TRANSCRIPTS / (base + ".txt")
    meta_path = INBOX_TRANSCRIPTS / (base + ".json")

    print(f"[{src.name}]")
    print(f"  moving to inbox/audio/")
    shutil.move(str(src), str(audio_dst))

    print(f"  converting to 16 kHz wav...")
    to_wav16k(audio_dst, wav_tmp)

    print(f"  transcribing...")
    text = transcribe(wav_tmp)
    wav_tmp.unlink(missing_ok=True)

    transcript_path.write_text(text + "\n")
    meta_path.write_text(json.dumps({
        "filename": src.name,
        "recorded_at_guess": parse_stamp(base),
        "processed_at": datetime.now().isoformat(timespec="seconds"),
        "audio_path": str(audio_dst.relative_to(ROOT)),
        "transcript": text,
    }, indent=2) + "\n")

    print(f"  transcript: {text}")
    print(f"  saved: {transcript_path.relative_to(ROOT)}")
    print()
    return transcript_path


def parse_stamp(base: str):
    """coach-YYYYMMDD-HHMM -> ISO datetime, or None."""
    parts = base.split("-")
    if len(parts) >= 3 and len(parts[1]) == 8 and len(parts[2]) == 4:
        try:
            d = parts[1]; t = parts[2]
            return f"{d[:4]}-{d[4:6]}-{d[6:8]}T{t[:2]}:{t[2:4]}:00"
        except Exception:
            pass
    return None


def list_pending():
    if not INBOX_TRANSCRIPTS.exists():
        print("(no transcripts yet)")
        return
    files = sorted(INBOX_TRANSCRIPTS.glob("*.json"))
    if not files:
        print("(no transcripts yet)")
        return
    for f in files:
        meta = json.loads(f.read_text())
        recorded = meta.get("recorded_at_guess") or "?"
        snippet = meta.get("transcript", "").replace("\n", " ")[:80]
        print(f"{recorded}  {f.stem}  {snippet}")


def print_all():
    if not INBOX_TRANSCRIPTS.exists():
        return
    for f in sorted(INBOX_TRANSCRIPTS.glob("*.json")):
        meta = json.loads(f.read_text())
        print(f"=== {f.stem} ({meta.get('recorded_at_guess', '?')}) ===")
        print(meta.get("transcript", ""))
        print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list queued transcripts")
    ap.add_argument("--print", action="store_true", dest="print_all", help="print all transcripts")
    args = ap.parse_args()

    if args.list:
        list_pending()
        return
    if args.print_all:
        print_all()
        return

    if not WHISPER:
        die("whisper-cli not found. Run: brew install whisper-cpp")
    if not FFMPEG:
        die("ffmpeg not found. Run: brew install ffmpeg")
    if not MODEL.exists():
        die(f"model not found at {MODEL}. Download with:\n"
            f"  curl -L -o {MODEL} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin")

    found = find_new_audio()
    if not found:
        print(f"No new coach-*.* files in {DOWNLOADS}.")
        return

    print(f"Found {len(found)} file(s) to process.\n")
    for p in found:
        try:
            process_one(p)
        except Exception as e:
            print(f"  FAILED: {e}\n")


if __name__ == "__main__":
    main()
