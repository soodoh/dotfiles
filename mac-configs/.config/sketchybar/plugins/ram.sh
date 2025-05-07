#!/bin/sh

MEM_TOTAL=$(sysctl -n hw.memsize)
MEM_TOTAL_MB=$((MEM_TOTAL / 1024 / 1024))
MEM_FREE_MB=$(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
MEM_INACTIVE_MB=$(vm_stat | grep "Pages inactive" | awk '{print $3}' | sed 's/\.//')
PAGE_SIZE=$(vm_stat | grep "page size of" | awk '{print $8}')
MEM_FREE_ACTUAL_MB=$(( (MEM_FREE_MB + MEM_INACTIVE_MB) * PAGE_SIZE / 1024 / 1024 ))
MEM_USED_MB=$((MEM_TOTAL_MB - MEM_FREE_ACTUAL_MB))
MEM_PERCENT=$(awk "BEGIN {printf \"%.0f\", ($MEM_USED_MB / $MEM_TOTAL_MB) * 100}")

sketchybar --set "$NAME" label="$MEM_PERCENT%"
