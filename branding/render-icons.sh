#!/usr/bin/env bash
#
# Rebuild every icon in the repo from the original artwork.
#
# The master was drawn sitting on a white rectangle with a drop shadow beneath
# it, and that whole plate was baked into each icon — so a white box showed up
# wherever the icon was placed. This clips the artwork to the plaque's own
# rounded-rectangle outline, which drops the white background and the outer
# shadow in one step while leaving every pixel inside the plaque untouched: the
# relief on the M, the gradients and the highlights all stay as they were drawn.
#
# The outline was measured, not guessed. Trimming the 2048 master reports
# 1667x1755 at +206+191; the extra 88 px of height is the shadow, so the plaque
# is 1667x1667 at (206,191). The corner radius is 400, solved from the corner
# arc at two heights on the 512 version and scaled by four.
#
# The Android launcher icons are rebuilt here too, when the Android project
# exists. They are not simply downscales — Android composes them from a
# foreground and a background of its own — so that step is documented where it
# happens, further down.
#
# Needs ImageMagick: sudo apt-get install imagemagick
# Node is used only for the macOS .icns; without it the sizes are left in
# .icns-sizes/ so the packing step can be run separately.
#
# Usage: bash branding/render-icons.sh   (from the repository root)
set -eu

ICONS=src-tauri/icons
MASTER=branding/meditor-icon-2048.png
[ -f "$MASTER" ] || { echo "run this from the repository root" >&2; exit 1; }

# Plaque outline within the 2048 master, and how far to pull the mask inside it.
LEFT=206
TOP=192
RIGHT=1801
BOTTOM=1860
RADIUS=395
ERODE=4

# App icons have to be square, and the artwork is 1596x1669, so the canvas is a
# square centred on the plaque. The few pixels of margin left and right are the
# price of not distorting it.
SIDE=$(( BOTTOM - TOP + 1 ))
CROP_X=$(( (LEFT + RIGHT) / 2 - SIDE / 2 ))
CROP_Y=$(( (TOP + BOTTOM) / 2 - SIDE / 2 ))

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "· clipping the artwork to the plaque"
convert -size 2048x2048 xc:black -fill white \
        -draw "roundrectangle $((LEFT + ERODE)),$((TOP + ERODE)) $((RIGHT - ERODE)),$((BOTTOM - ERODE)) $RADIUS,$RADIUS" \
        "$TMP/mask.png"
convert "$MASTER" "$TMP/mask.png" -alpha off -compose CopyOpacity -composite \
        -crop "${SIDE}x${SIDE}+${CROP_X}+${CROP_Y}" +repage "$TMP/cut.png"

# Every size below is a downscale of that one clipped master, so they all carry
# the same artwork.
png() { convert "$TMP/cut.png" -filter Lanczos -resize "${1}x${1}" -strip "$2"; }

echo "· square icons"
for size in 30 44 71 89 107 142 150 284 310; do
  png "$size" "$ICONS/Square${size}x${size}Logo.png"
done
png 50 "$ICONS/StoreLogo.png"
png 32 "$ICONS/32x32.png"
png 128 "$ICONS/128x128.png"
png 256 "$ICONS/128x128@2x.png"
png 512 "$ICONS/icon.png"

echo "· windows .ico"
for size in 16 24 32 48 64 128 256; do png "$size" "$TMP/ico-$size.png"; done
convert "$TMP"/ico-16.png "$TMP"/ico-24.png "$TMP"/ico-32.png "$TMP"/ico-48.png \
        "$TMP"/ico-64.png "$TMP"/ico-128.png "$TMP"/ico-256.png "$ICONS/icon.ico"

echo "· favicon"
convert "$TMP"/ico-16.png "$TMP"/ico-32.png "$TMP"/ico-48.png public/favicon.ico

echo "· macOS .icns"
# Packed by our own script rather than with png2icns, which is not always
# installable — and never with ImageMagick, whose ICNS writer quietly emits a
# plain PNG under an .icns name that macOS refuses to read.
if command -v node >/dev/null 2>&1; then
  for size in 16 32 64 128 256 512 1024; do png "$size" "$TMP/icns-$size.png"; done
  node branding/pack-icns.mjs "$ICONS/icon.icns" \
    16="$TMP/icns-16.png" 32="$TMP/icns-32.png" 64="$TMP/icns-64.png" \
    128="$TMP/icns-128.png" 256="$TMP/icns-256.png" 512="$TMP/icns-512.png" \
    1024="$TMP/icns-1024.png"
else
  mkdir -p .icns-sizes
  for size in 16 32 64 128 256 512 1024; do png "$size" ".icns-sizes/i-$size.png"; done
  echo "  node not found — sizes left in .icns-sizes/. Finish with:"
  echo "  node branding/pack-icns.mjs $ICONS/icon.icns \\"
  echo "    16=.icns-sizes/i-16.png ... 1024=.icns-sizes/i-1024.png"
fi

echo "· android launcher icons"
# Android composes its own launcher icon: a 108dp canvas of which only the
# middle 72dp is guaranteed visible, the mask (circle, squircle, teardrop —
# the launcher decides) applied on top, and a separate background showing
# through wherever the foreground does not reach.
#
# So the plaque is placed at 75% of the canvas. That is large enough to cover
# the whole visible area under any mask, which is what keeps the background
# from ever framing the artwork the way `tauri icon` does with its white
# default, and small enough that the M stays inside the safe circle instead of
# being clipped by a round mask.
#
# The background colour is the average of the plaque's four corners. The
# plaque runs from #49566A top-left to #1E2733 bottom-right, so no flat colour
# matches it everywhere — but at 75% it is only ever seen during the launcher's
# parallax, where a mid slate reads as part of the artwork.
ANDROID_RES=src-tauri/gen/android/app/src/main/res
ANDROID_BG='#2D3848'
FG_SCALE=75

if [ -d "$ANDROID_RES" ]; then
  # density:launcher-px — the adaptive canvas is 108/48 of the launcher size.
  for entry in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
    density=${entry%%:*}
    launcher=${entry##*:}
    canvas=$(( launcher * 108 / 48 ))
    inner=$(( canvas * FG_SCALE / 100 ))
    dir="$ANDROID_RES/mipmap-$density"
    mkdir -p "$dir"

    # Legacy icon, for launchers older than adaptive icons: the plaque as it
    # is, rounded corners and transparency included.
    png "$launcher" "$dir/ic_launcher.png"

    # Round variant, for the API 25 launchers that ask for one.
    convert "$TMP/cut.png" -filter Lanczos -resize "${launcher}x${launcher}" \
            \( +clone -alpha extract -fill black -colorize 100 \
               -fill white -draw "circle $((launcher/2)),$((launcher/2)) $((launcher/2)),0" \
               -alpha off \) \
            -compose CopyOpacity -composite -strip "$dir/ic_launcher_round.png"

    # Adaptive foreground: the plaque centred on a transparent canvas.
    convert "$TMP/cut.png" -filter Lanczos -resize "${inner}x${inner}" \
            -background none -gravity center -extent "${canvas}x${canvas}" \
            -strip "$dir/ic_launcher_foreground.png"
  done

  mkdir -p "$ANDROID_RES/mipmap-anydpi-v26"
  cat > "$ANDROID_RES/mipmap-anydpi-v26/ic_launcher.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background" />
  <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
XML
  cat > "$ANDROID_RES/mipmap-anydpi-v26/ic_launcher_round.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background" />
  <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
XML
  cat > "$ANDROID_RES/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">$ANDROID_BG</color>
</resources>
XML
else
  echo "  no android project (src-tauri/gen/android) — skipped"
fi

echo "· social preview"
# Only the icon inside the card is replaced: the wordmark is baked into this
# PNG and redrawing it would need the exact fonts. The old icon sat on a
# 259x259 white plate at (510,60); the card background is #1E1E1E. The clipped
# artwork carries no margin of its own, so 211px keeps its visual size.
png 211 "$TMP/social-icon.png"
convert branding/social-preview.png \
        -fill '#1E1E1E' -draw 'rectangle 508,58 770,320' \
        "$TMP/social-icon.png" -geometry +534+84 -composite \
        branding/social-preview.png

# Last, because everything above reads it.
cp "$TMP/cut.png" "$MASTER"

echo
echo "Done. Checking that nothing kept an opaque background:"
for f in "$ICONS"/*.png "$MASTER"; do
  printf '  %-42s alpha_min=%s\n' "$f" \
    "$(convert "$f" -format '%[fx:minima.a]' info:)"
done
