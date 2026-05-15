#!/usr/bin/env python3
"""OpenCV haarcascade face detector.

Usage: python3 face_detect.py <video_path> [sample_fps]

Prints a JSON object to stdout:
  {"fps": <sample_fps>, "frames": [{"t": <sec>, "n": <face_count>, "area_pct": <0..100>}]}

Used by lib/analyze/faces.mjs to compute per-clip face presence stats which
then bias the smart-pick scorer toward people-bearing shots for the hook and
chorus pools.
"""

import json
import sys

import cv2

SAMPLE_FPS = 5
ANALYZE_W = 320
ANALYZE_H = 180


def detect(path: str, sample_fps: float = SAMPLE_FPS):
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if cascade.empty():
        raise RuntimeError("haarcascade load failed")
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"could not open: {path}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(src_fps / sample_fps)))
    frames = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            h, w = frame.shape[:2]
            scale = min(ANALYZE_W / w, ANALYZE_H / h, 1.0)
            small = cv2.resize(frame, (max(1, int(w * scale)), max(1, int(h * scale)))) if scale < 1 else frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=4, minSize=(20, 20))
            total_px = small.shape[0] * small.shape[1]
            area = sum(int(fw) * int(fh) for (_, _, fw, fh) in faces) if total_px > 0 else 0
            frames.append({
                "t": round(idx / src_fps, 3),
                "n": int(len(faces)),
                "area_pct": round(100.0 * area / total_px, 2) if total_px else 0.0,
            })
        idx += 1
    cap.release()
    return {"fps": sample_fps, "frames": frames}


def main():
    if len(sys.argv) < 2:
        print("usage: face_detect.py <video> [sample_fps]", file=sys.stderr)
        sys.exit(2)
    sample = float(sys.argv[2]) if len(sys.argv) > 2 else SAMPLE_FPS
    out = detect(sys.argv[1], sample)
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
