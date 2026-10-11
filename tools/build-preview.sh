#!/usr/bin/env bash
# Puts the README pictures and preview.png together, as More Time's and More
# Weather's tools/build-preview.sh do, from raw screenshots taken on an empty
# workspace (only the wallpaper behind, no private windows):
#   ring.png                 the ring menu opened with `openRing`, cropped square
#   settings-<page>.png      the settings window, one per page
#                            (general, mouse, trackpad, ring, changes)
# Colours come from the current Omarchy theme, the font is JetBrains Mono.
#   tools/build-preview.sh <raw-screenshot-dir>
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
in=${1:?usage: $0 <raw-screenshot-dir>}
theme="$HOME/.local/state/omarchy/current/theme/colors.toml"
color() { sed -n "s/^$1 *= *\"\\(#[0-9a-fA-F]*\\)\".*/\\1/p" "$theme" | head -n 1; }
bg=$(color background); bg=${bg:-#1a1b26}
fg=$(color foreground); fg=${fg:-#a9b1d6}
accent=$(color accent); accent=${accent:-#7aa2f7}
muted=$(color dark_foreground); muted=${muted:-#565f89}
line=$(color lighter_background); line=${line:-#24283b}
font=$(fc-match -f '%{file}' "JetBrainsMono Nerd Font:style=Regular")
bold=$(fc-match -f '%{file}' "JetBrainsMono Nerd Font:style=Bold")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$root/screenshots"
cp "$in/ring.png" "$root/screenshots/ring.png"
for page in general mouse trackpad ring changes; do
  cp "$in/settings-$page.png" "$root/screenshots/settings-$page.png"
done

# The preview: the list on the left, the ring in the middle, two settings
# pages on the right.
magick "$in/ring.png" -resize 820x -bordercolor "$line" -border 3 "$work/ring.png"
magick "$in/settings-mouse.png" -crop 820x560+0+0 +repage -resize 700x -bordercolor "$line" -border 3 "$work/p1.png"
magick "$in/settings-ring.png" -crop 820x560+0+0 +repage -resize 700x -bordercolor "$line" -border 3 "$work/p2.png"

bullets=("Mouse gestures, Opera style" "3 & 4 finger trackpad shapes" "A ring menu with three rings" "Eleven ring and trail styles")
args=()
y=560
for text in "${bullets[@]}"; do
  args+=(-font "$font" -pointsize 34 -fill "$fg" -annotate "+156+$y" "$text"
    -fill "$accent" -annotate "+104+$y" "•")
  y=$((y + 70))
done

magick -size 2400x1350 "xc:$bg" \
  -fill "$accent" -draw "roundrectangle 90,150 420,206 8,8" \
  -font "$bold" -pointsize 30 -fill "$bg" -annotate +118+190 "VERSION 1.0" \
  -font "$bold" -pointsize 78 -fill "$accent" -annotate +86+330 "More Gestures" \
  -font "$font" -pointsize 40 -fill "$fg" -annotate +92+398 "for Omarchy" \
  "${args[@]}" \
  -font "$font" -pointsize 30 -fill "$muted" -annotate +98+1040 "30 languages · one gesture language" \
  -annotate +98+1080 "settings saved as you go" \
  "$work/ring.png" -geometry +785+260 -composite \
  "$work/p1.png" -geometry +1640+110 -composite \
  "$work/p2.png" -geometry +1640+720 -composite \
  "$root/preview.png"
echo "preview.png and screenshots/ updated"
