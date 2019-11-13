# Variables
############################

# Date and time
date_and_week=$(date "+%D (%a)")
current_time=$(date +%T)

# Battery or charger
battery_charge=$(cat /sys/class/power_supply/BAT0/capacity)%
battery_status=$(cat /sys/class/power_supply/BAT0/status)

# Audio and multimedia
audio_volume=$(amixer sget Master | awk -F"[][]" '/dB/ { print $2 }')
audio_is_muted=$(amixer sget Master | awk -F"[][]" '/dB/ { print $6 }')
media_artist=$(playerctl metadata artist)
media_song=$(playerctl metadata title)
player_status=$(playerctl status)

# Network
network=$(ip route get 1.1.1.1 | grep -Po '(?<=dev\s)\w+' | cut -f1 -d ' ')
# interface_easyname grabs the "old" interface name before systemd renamed it
interface_easyname=$(dmesg | grep $network | grep renamed | awk 'NF>1{print $NF}')
ping=$(ping -c 1 www.google.com | tail -1| awk '{print $4}' | cut -d '/' -f 2 | cut -d '.' -f 1)

# Others
language=$(swaymsg -r -t get_inputs | awk '/1:1:AT_Translated_Set_2_keyboard/;/xkb_active_layout_name/' | grep -A1 '\b1:1:AT_Translated_Set_2_keyboard\b' | grep "xkb_active_layout_name" | awk -F '"' '{print $4}')
loadavg_5min=$(cat /proc/loadavg | awk -F ' ' '{print $2}')


# Conditional Variables
############################

if [ $battery_status = "Discharging" ];
then
    battery_pluggedin='⚠'
else
    battery_pluggedin='⚡'
fi

if ! [ $network ]
then
   network_active="⛔"
else
   network_active="⇆"
fi

if [ $player_status = "Playing" ]
then
    song_status='▶'
elif [ $player_status = "Paused" ]
then
    song_status='⏸'
else
    song_status='⏹'
fi

if [ $audio_is_muted = "on" ]
then
    audio_active='🔇'
else
    audio_active='🔊'
fi

if [ $media_artist ]
then
  echo "🎧 $song_status $media_artist - $media_song   |   "
fi

echo "$network_active $interface_easyname ($ping ms)   |   $audio_active $audio_volume   |   $battery_pluggedin $battery_charge   |   $date_and_week   🕘 $current_time  "
