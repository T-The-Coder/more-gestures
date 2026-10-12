#!/usr/bin/env bash
# Puts the README pictures and preview.png together, as More Time's and More
# Weather's tools/build-preview.sh do, from raw screenshots taken on an empty
# workspace (only the wallpaper behind, no private windows), interface in English:
#   ring-<style>-full.png    the whole screen with the ring open (`openRing`, pointer
#                            at 960,620 on a 1920x1200 screen), one per ring style
#   trail-<style>.png        the settings window on the Mouse page (grim -g
#                            "550,170 820x860"), one per trail style
#   settings-<page>.png      the settings window, one per page
#                            (general, mouse, trackpad, ring, setup, changes)
#   gesture.png              the whole screen during a ↓→ gesture with the Neon
#                            trail (started at 700,380, then down and right), shot
#                            while still moving so the trail is complete
# Without ring-<style>/trail-<style> shots for every style the two style grids are
# left as they are (they only change with the styles).
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

styles=(plain comets clouds radar orbits ink neon pulse clockwork aurora fireflies)
ring_names=("Plain" "Comets" "Drifting clouds" "Radar" "Orbits" "Ink in water" "Neon" "Pulse" "Clockwork" "Aurora" "Fireflies")
trail_names=("Plain" "Comet" "Vapour trail" "Blips" "Stardust" "Brush stroke" "Neon" "Pulsing line" "Dashes" "Ribbon of light" "Sparks")

ring_crop() { magick "$in/ring-$1-full.png" -crop 680x680+620+280 +repage "$2"; }
trail_crop() { magick "$in/trail-$1.png" -crop 262x180+418+432 +repage "$2"; }

gesture_crop() { magick "$in/gesture.png" -crop 820x385+450+280 +repage -resize 1000x "$1"; }

mkdir -p "$root/screenshots"
ring_crop comets "$root/screenshots/ring.png"
gesture_crop "$root/screenshots/gesture.png"
# The Setup page's picture is settings-access.png: the marketplace scan treats any
# binary file whose name says setup or install as a possible hidden installer.
for page in general mouse trackpad ring setup changes; do
  name=$page; [[ $page == setup ]] && name=access
  cp "$in/settings-$page.png" "$root/screenshots/settings-$name.png"
done

# A grid of cells, each a picture with its name below; a title over it all.
grid() {  # output title cell-width picture-height columns kind(ring|trail)
  local out=$1 title=$2 w=$3 h=$4 cols=$5 kind=$6 i=0 cells=()
  for s in "${styles[@]}"; do
    local name
    if [[ $kind == ring ]]; then name=${ring_names[$i]}; ring_crop "$s" "$work/raw.png"
    else name=${trail_names[$i]}; trail_crop "$s" "$work/raw.png"; fi
    magick "$work/raw.png" -resize "${w}x${h}" -background "$bg" -gravity center -extent "${w}x${h}" \
      -bordercolor "$line" -border 2 \
      \( -size "$((w + 4))x56" "xc:$bg" -font "$font" -pointsize 26 -fill "$fg" -gravity center -annotate +0+0 "$name" \) \
      -append "$work/cell-$i.png"
    cells+=("$work/cell-$i.png")
    i=$((i + 1))
  done
  magick montage "${cells[@]}" -tile "${cols}x" -geometry +18+18 -background "$bg" "$work/grid.png"
  magick "$work/grid.png" -gravity north -background "$bg" -splice 0x110 \
    -font "$bold" -pointsize 44 -fill "$accent" -annotate +0+34 "$title" \
    -bordercolor "$bg" -border 30 -depth 8 "$out"
}
have_all() { local s; for s in "${styles[@]}"; do [[ -f "$in/$1-$s$2" ]] || return 1; done; }
if have_all ring -full.png; then grid "$root/screenshots/styles.png" "Eleven ring styles" 380 380 4 ring; fi
if have_all trail .png; then grid "$root/screenshots/trails.png" "And a trail for every gesture" 393 270 4 trail; fi

# The preview: name and slogan, a cheat sheet of the gesture language; on the right
# a gesture being drawn (↓→, Neon trail) over the ring menu (Comets).
gesture_crop "$work/gesture.png"
magick "$work/gesture.png" -bordercolor "$line" -border 3 "$work/gesture.png"
ring_crop comets "$work/hero.png"
magick "$work/hero.png" -resize 660x -bordercolor "$line" -border 3 "$work/hero.png"

rows=("↓→" "close tab" "↓←" "close window" "↑← ↑→" "workspace left / right" "← →" "back / forward"
  "↑" "Exposé, then the app launcher" "↓" "wallpaper, then Files" "2× click" "hold: the ring menu")
args=()
y=760
for ((r = 0; r < ${#rows[@]}; r += 2)); do
  args+=(-font "$bold" -pointsize 38 -fill "$accent" -annotate "+104+$y" "${rows[r]}"
    -font "$font" -pointsize 34 -fill "$fg" -annotate "+460+$y" "${rows[r + 1]}")
  y=$((y + 62))
done

magick -size 2400x1350 "xc:$bg" \
  -fill "$accent" -draw "roundrectangle 98,96 420,150 8,8" \
  -font "$bold" -pointsize 30 -fill "$bg" -annotate +124+134 "VERSION 1.1" \
  -font "$bold" -pointsize 96 -fill "$accent" -annotate +92+290 "More Gestures" \
  -font "$font" -pointsize 52 -fill "$fg" -annotate +98+400 "Control Omarchy with" \
  -annotate +98+468 "Mouse and Trackpad Gestures" \
  -font "$font" -pointsize 30 -fill "$muted" -annotate +100+560 "Hold the right button, draw, release. Three fingers do the same." \
  -fill "$line" -draw "rectangle 98,640 1200,644" \
  -font "$font" -pointsize 26 -fill "$muted" -annotate +104+700 "ONE GESTURE LANGUAGE, EVERY PROGRAM" \
  "${args[@]}" \
  -font "$font" -pointsize 28 -fill "$muted" -annotate +100+1250 "30 languages · 11 ring styles · 11 trails · no packages to install" \
  "$work/gesture.png" -geometry +1300+96 -composite \
  "$work/hero.png" -geometry +1470+604 -composite \
  -depth 8 "$root/preview.png"
echo "preview.png and screenshots/ updated"
