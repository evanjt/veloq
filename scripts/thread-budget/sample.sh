#!/system/bin/sh
# Samples every thread of one process on the device, with no adb round trip per
# sample. Usage: sh sample.sh <pid> <out> <seconds>
# Each sample is a "T <uptime>" line, then the device's aggregate cpu line from
# /proc/stat, the process RSS, and one line per thread:
#   <tid> <comm> <utime> <stime> <nice> <processor>
# and one "S <tid> <run_ns> <runqueue_wait_ns>" line per thread from schedstat.
# Times are in clock ticks. Reading /proc avoids dumpsys meminfo, which forces a
# GC in the app on every call.
pid=$1
out=$2
secs=${3:-60}
end=$(( $(cut -d. -f1 /proc/uptime) + secs ))
: > "$out"
while [ "$(cut -d. -f1 /proc/uptime)" -lt "$end" ]; do
  [ -d /proc/$pid ] || break
  {
    echo "T $(cut -d' ' -f1 /proc/uptime)"
    head -1 /proc/stat
    grep VmRSS /proc/$pid/status
    awk '
    FILENAME ~ /schedstat$/ { split(FILENAME, d, "/"); print "S", d[5], $1, $2; next }
    {
      s=$0; o=index(s,"("); c=0
      for (i=length(s); i>0; i--) if (substr(s,i,1)==")") { c=i; break }
      comm=substr(s,o+1,c-o-1); gsub(/ /,"_",comm)
      n=split(substr(s,c+2),f," ")
      print $1, comm, f[12], f[13], f[17], f[37]
    }' /proc/$pid/task/*/stat /proc/$pid/task/*/schedstat 2>/dev/null
  } >> "$out"
  sleep 0.02
done
