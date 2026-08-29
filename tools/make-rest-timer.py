#!/usr/bin/env python3
"""Renders assets/rest-timer.mp4 — the video the rest timer plays.

iOS can't stream a live <canvas> into Picture-in-Picture (WebKit bug 181663), so the
timer is a real video file instead: one 10-minute countdown that every rest length
seeks into. An N-second rest starts at t=600-N and runs to 0:00, which means the
system plays the countdown — it keeps ticking, and still beeps, while the PWA is
backgrounded or suspended. Ten seconds of "GO" follow so the end is visible too.

Regenerate:  python3 tools/make-rest-timer.py
"""
import math, os, shutil, struct, subprocess, tempfile, wave
from PIL import Image, ImageDraw, ImageFont

W, H, SPAN, TAIL = 480, 270, 600, 10          # 16:9, counts down from 10:00, then 10s of GO
BG, DIM = (13, 17, 23), (90, 102, 117)        # --bg, --faint
FG, WARN, GOOD = (230, 237, 243), (227, 179, 65), (63, 185, 80)
GO_BG = (18, 53, 28)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "rest-timer.mp4")
SR = 44100

def fitted(text, target_w):
    """Largest font size at which `text` still fits target_w."""
    size = 10
    while size < 400:
        f = ImageFont.truetype(FONT, size + 2)
        if f.getbbox(text)[2] - f.getbbox(text)[0] > target_w:
            break
        size += 2
    return ImageFont.truetype(FONT, size)

def centered(draw, text, font, fill, cy):
    x0, y0, x1, y1 = draw.textbbox((0, 0), text, font=font)
    draw.text(((W - (x1 - x0)) / 2 - x0, cy - (y1 - y0) / 2 - y0), text, font=font, fill=fill)

def render_frames(dirpath):
    big, label = fitted("10:00", W - 60), ImageFont.truetype(FONT, 20)
    for i in range(SPAN + TAIL):
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        if i < SPAN:
            r = SPAN - i                       # seconds still to go
            centered(d, "REST", label, DIM, 34)
            centered(d, f"{r // 60}:{r % 60:02d}", big, WARN if r <= 10 else FG, H // 2 + 14)
        else:
            img.paste(GO_BG if (i - SPAN) % 2 == 0 else BG, (0, 0, W, H))
            d = ImageDraw.Draw(img)
            centered(d, "GO", big, GOOD, H // 2)
        img.save(os.path.join(dirpath, f"{i:04d}.png"))

def render_audio(path):
    """Silence, then 3 ticks counting down and a two-note chime landing exactly on 0:00."""
    beeps = [(SPAN - 3, 0.08, 880, 0.35), (SPAN - 2, 0.08, 880, 0.35), (SPAN - 1, 0.08, 880, 0.35),
             (SPAN, 0.28, 1320, 0.5), (SPAN + 0.35, 0.28, 1320, 0.5)]
    total = (SPAN + TAIL) * SR
    buf = bytearray(total * 2)
    for start, dur, freq, amp in beeps:
        n = int(dur * SR)
        for k in range(n):
            env = min(1.0, k / 220, (n - k) / 220)     # 5ms fades, so it doesn't click
            v = int(32767 * amp * env * math.sin(2 * math.pi * freq * k / SR))
            struct.pack_into("<h", buf, (int(start * SR) + k) * 2, v)
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(bytes(buf))

def main():
    tmp = tempfile.mkdtemp()
    try:
        render_frames(tmp)
        render_audio(os.path.join(tmp, "beeps.wav"))
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error",
            "-framerate", "1", "-i", os.path.join(tmp, "%04d.png"),
            "-i", os.path.join(tmp, "beeps.wav"),
            # yuv420p + main profile + even dimensions = the combination iOS will decode
            "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p",
            # 1 fps is the content's real rate — the display only changes once a second — and
            # a keyframe every 30s keeps seeking to an arbitrary rest length cheap
            "-r", "1", "-g", "30", "-crf", "30", "-tune", "stillimage",
            "-c:a", "aac", "-b:a", "32k", "-ac", "1", "-ar", "24000",
            "-movflags", "+faststart", "-shortest", OUT,
        ], check=True)
        print(f"wrote {os.path.relpath(OUT)} — {os.path.getsize(OUT)/1024:.0f} KB")
    finally:
        shutil.rmtree(tmp)

if __name__ == "__main__":
    main()
