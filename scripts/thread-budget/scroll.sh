#!/system/bin/sh
# Swipe the screen up and down for a fixed count, to drive frames while a pass runs.
n=${1:-12}
i=0
while [ $i -lt $n ]; do
  input swipe 540 1900 540 700 250
  input swipe 540 700 540 1900 250
  i=$((i + 1))
done
