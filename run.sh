#!/usr/bin/env bash
# Generate cut.fcpxml with optional style/clips/bpm/bars flags, open it in
# Final Cut Pro, poll until import finishes, then apply style-appropriate
# effects + a color preset fully in the background (FCP never needs to be
# frontmost). Finally trigger Share to render the timeline to MP4.
#
# Usage:
#   ./run.sh                                         # test-pattern montage 16b @ 140
#   ./run.sh --mode=clips --clips=./footage
#   ./run.sh --style=cinematic --bpm=92 --bars=24
#   ./run.sh --style=jump-cut --bars=16
set -euo pipefail
cd "$(dirname "$0")"

STYLE="montage"
for arg in "$@"; do
  case "$arg" in
    --style=*) STYLE="${arg#--style=}" ;;
  esac
done

node make-cut.mjs "$@"
node fcp.mjs open cut.fcpxml

# Poll until FCP has imported the timeline. listTimelineClips returns
# something once the spine has assets; require at least 2 clips before
# moving to the effect-swap stage.
for i in $(seq 1 30); do
  n=$(node fcp.mjs tracks 2>/dev/null | grep -c '"description"' || true)
  [ "$n" -ge 2 ] && break
  sleep 0.5
done
if [ "$n" -lt 2 ]; then
  echo "FCP did not finish importing (only $n timeline clips). Continuing anyway..."
fi

# Prime the Cua daemon + element cache.
node fcp.mjs cua-init >/dev/null

# Background effect application via Cua. Other apps can stay frontmost.
case "$STYLE" in
  montage)
    node fcp.mjs cua-effect "Cross Dissolve" || true
    ;;
  cinematic)
    node fcp.mjs cua-effect "Cinematic" || true
    node fcp.mjs cua-color-preset "Vibrant" || true
    ;;
  jump-cut)
    node fcp.mjs cua-effect "Letterbox" || true
    ;;
  slow-mo)
    node fcp.mjs cua-effect "Slow Motion" || true
    ;;
esac

# Render the timeline to MP4 via Share. File lands in ~/Movies by default.
EXPORT_NAME="cut-${STYLE}-${RANDOM}"
node fcp.mjs cua-export "$EXPORT_NAME" || true

EXPORT_FILE="$HOME/Movies/${EXPORT_NAME}.mov"
echo "Cut ready in Final Cut Pro. 'node fcp.mjs cua-play' to play (no focus steal)."
echo "Export queued: $EXPORT_FILE (Share runs asynchronously inside FCP)"
