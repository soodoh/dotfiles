separator='   |   '

# Date and time
###############################
date_and_week=$(date "+%D (%a)")
current_time=$(date +%T)
date_content="$date_and_week   🕘 $current_time"

# Battery or charger
###############################
battery_charge=$(cat /sys/class/power_supply/BAT0/capacity)%
battery_status=$(cat /sys/class/power_supply/BAT0/status)
if [ $battery_status = "Discharging" ];
then
    battery_icon='🔋'
else
    battery_icon='⚡'
fi
battery_content="$battery_icon $battery_charge"

# Multimedia
###############################
media_artist=$(playerctl metadata artist)
media_song=$(playerctl metadata title)
player_status=$(playerctl status)
if [ $player_status = "Playing" ]
then
    song_status='▶'
elif [ $player_status = "Paused" ]
then
    song_status='⏸'
else
    song_status='⏹'
fi
if [ $media_artist ]
then
  player_content="🎧 $song_status $media_artist - $media_song$separator"
fi

# Audio
###############################
audio_volume=$(amixer sget Master | awk -F"[][]" '/dB/ { print $2 }')
audio_is_muted=$(amixer sget Master | awk -F"[][]" '/dB/ { print $6 }')
if [ $audio_is_muted = "on" ]
then
    audio_active='🔇'
else
    audio_active='🔊'
fi
audio_content="$audio_active  $audio_volume"

# Network
###############################
network=$(ip route get 1.1.1.1 | grep -Po '(?<=dev\s)\w+' | cut -f1 -d ' ')
ping=$(ping -c 1 www.google.com | tail -1| awk '{print $4}' | cut -d '/' -f 2 | cut -d '.' -f 1)
if [ $network = 'ens1' ];
then
  interface_content='Ethernet'
else
  interface_content="  $(nmcli -f in-use,ssid d wifi list | grep ^\* | sed  's/^\*\s*//' | sed 's/\s*$//')"
fi
interface_content+=" ($ping ms)"
if ! [ $network ]
then
   network_icon="⛔"
else
   network_icon="⇆"
fi
network_content="$network_icon $interface_content"

# CPU
###############################
cpu_speed="CPU $(mpstat | grep all | awk '/\s+/{print $4}' | awk '{print int($1 + 0.5)}')%"
cpu_temp="$(sensors | awk '/^Core /{++r; gsub(/[^[:digit:]]+/, "", $3); s+=$3} END{print int(s/(10*r)+0.5)}')°C"
cpu_content="$cpu_speed   ($cpu_temp)"

# CPU
###############################
used_space="$(df -BG | grep nvme0n1p4 | awk '{print $3}')"
available_space="$(df -BG | grep nvme0n1p4 | awk '{print $4}')"
storage_content="$used_space / $available_space"


# Others
###############################
# language=$(swaymsg -r -t get_inputs | awk '/1:1:AT_Translated_Set_2_keyboard/;/xkb_active_layout_name/' | grep -A1 '\b1:1:AT_Translated_Set_2_keyboard\b' | grep "xkb_active_layout_name" | awk -F '"' '{print $4}')
# loadavg_5min=$(cat /proc/loadavg | awk -F ' ' '{print $2}')


echo "$player_content$network_content$separator$storage_content$separator$cpu_content$separator$audio_content$separator$battery_content$separator$date_content  "
