#!/bin/sh
# Synthetic media for the test stack and the fixtures test: testsrc2 video plus a sine tone, 6 s each.
# Usage: make-fixtures.sh <out dir>
# Run inside the worker image so its ffmpeg is used; nothing here is a real film.
set -eu

OUT="${1:?usage: make-fixtures.sh <out dir>}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

ff() { ffmpeg -v error -y "$@"; }
# Constant bit rate: the padding (nal-hrd=cbr) keeps testsrc2 from coming out far smaller than asked.
cbr() { echo "-b:v $1 -minrate $1 -maxrate $1 -bufsize $1 -x264-params nal-hrd=cbr"; }
video() { echo "-f lavfi -i testsrc2=size=$1:rate=25"; }
tone="-f lavfi -i sine=frequency=440:sample_rate=48000"
tone2="-f lavfi -i sine=frequency=880:sample_rate=48000"
H264="-c:v libx264 -preset ultrafast -pix_fmt yuv420p"

mkdir -p "$OUT/movies/Big Film (2001)" "$OUT/movies/Scope Film (2010)" "$OUT/movies/Lean Film (2015)" \
  "$OUT/movies/Phone Film (2018)" "$OUT/movies/Old Film (1999)" "$OUT/movies/HDR Film (2020)" \
  "$OUT/movies/Laced (2003)" "$OUT/movies/Broken (2000)" "$OUT/movies/Cover Film (2012)" \
  "$OUT/tv/Test Show/Season 01" "$OUT/tv/Test Show/Season 02" "$OUT/music/Decoy"

printf '1\n00:00:00,000 --> 00:00:03,000\nHello\n' > "$T/sub.srt"
printf ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=6000\ntitle=One\n' > "$T/chapters.txt"

# compress: 20 Mbit/s h264 1080p, two audio tracks, an srt sub and a chapter
# shellcheck disable=SC2046
ff $(video 1920x1080) $tone $tone2 -i "$T/sub.srt" -i "$T/chapters.txt" -t 6 \
  -map 0:v -map 1:a -map 2:a -map 3 -map_chapters 4 \
  $H264 $(cbr 20M) -c:a aac -b:a 64k -c:s srt \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=fra -metadata:s:s:0 language=eng \
  "$OUT/movies/Big Film (2001)/Big Film.mkv"

# compress: 1920x800 lands in the 1080p bucket
# shellcheck disable=SC2046
ff $(video 1920x800) $tone -t 6 $H264 $(cbr 12M) -c:a aac -b:a 64k "$OUT/movies/Scope Film (2010)/Scope Film.mkv"

# ok: already lean
# shellcheck disable=SC2046
ff $(video 1920x1080) $tone -t 6 $H264 $(cbr 2M) -c:a aac -b:a 64k "$OUT/movies/Lean Film (2015)/Lean Film.mkv"

# compress in MP4: mov_text subtitles can stay
# shellcheck disable=SC2046
ff $(video 1280x720) $tone -i "$T/sub.srt" -t 6 -map 0:v -map 1:a -map 2 \
  $H264 $(cbr 8M) -c:a aac -b:a 64k -c:s mov_text "$OUT/movies/Phone Film (2018)/Phone Film.mp4"

# cant: AVI can't hold HEVC
ff $(video 640x480) $tone -t 6 -c:v mpeg4 -b:v 3M -c:a pcm_s16le "$OUT/movies/Old Film (1999)/Old Film.avi"

# skip: HDR10 (10-bit hevc, PQ transfer, BT.2020)
ff $(video 1920x1080) $tone -t 6 -vf setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc \
  -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -b:v 5M -x265-params log-level=error \
  -c:a aac -b:a 64k "$OUT/movies/HDR Film (2020)/HDR Film.mkv"

# skip: interlaced (top field first)
# shellcheck disable=SC2046
ff $(video 1920x1080) $tone -t 6 -vf interlace=scan=tff $H264 -flags +ilme+ildct -field_order tt $(cbr 8M) \
  -c:a aac -b:a 64k "$OUT/movies/Laced (2003)/Laced.mkv"

# compress: an attached PNG cover must not count as a second video stream
# shellcheck disable=SC2046
ff $(video 600x900) -frames:v 1 "$T/cover.png"
# shellcheck disable=SC2046
ff $(video 1920x1080) $tone -i "$T/cover.png" -t 6 -map 0:v -map 1:a -map 2   $H264 $(cbr 20M) -c:a aac -b:a 64k -c:v:1 png -disposition:v:1 attached_pic "$OUT/movies/Cover Film (2012)/Cover Film.mp4"

# compress: two 720p episodes
for e in 01 02; do
  # shellcheck disable=SC2046
  ff $(video 1280x720) $tone -t 6 $H264 $(cbr 6M) -c:a aac -b:a 64k "$OUT/tv/Test Show/Season 01/Test Show S01E$e.mkv"
done

# ok: hevc 720p at 1 Mbit/s
ff $(video 1280x720) $tone -t 6 -c:v libx265 -preset ultrafast -pix_fmt yuv420p -b:v 1M -x265-params log-level=error \
  -c:a aac -b:a 64k "$OUT/tv/Test Show/Season 02/Test Show S02E01.mkv"

# probe error: the last 4 KB of a real clip has no container header
tail -c 4096 "$OUT/movies/Big Film (2001)/Big Film.mkv" > "$OUT/movies/Broken (2000)/Broken.mkv"

# never listed: out of scope
cp "$OUT/movies/Lean Film (2015)/Lean Film.mkv" "$OUT/music/Decoy/decoy.mkv"
