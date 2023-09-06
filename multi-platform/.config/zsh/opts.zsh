# Inspired by this example:
# https://gist.github.com/mattmc3/c490d01751d6eb80aa541711ab1d54b1

# Changing Directories
#######################
# if a command isn't valid, but is a directory, cd to that dir
setopt auto_cd
# make cd push the old directory onto the directory stack
setopt auto_pushd
# don't push dupe directories onto the directory stack
setopt pushd_ignore_dups

# Completions
##############
# move cursor to the end of a completed word
setopt always_to_end
# automatically list choices on ambiguous completion
setopt auto_list
# show completion menu on a successive tab press
setopt auto_menu
# if completed parameter is a directory, add a trailing slash
setopt auto_param_slash
# complete from both ends of a word
setopt complete_in_word
# don't autoselect the first completion entry
unsetopt menu_complete

# Expansion & Globbing
########################
# http://zsh.sourceforge.net/Doc/Release/Options.html#Expansion-and-Globbing
# use more globbing features
setopt extended_glob
# include dotfiles when globbing
setopt glob_dots

# History
##########
# append to history file
setopt append_history
# write history file in the ":start:elapsed;command" format
setopt extended_history
# don't beep when attempting to access a missing history entry
unsetopt hist_beep
# expire a dupe event first when trimming history
setopt hist_expire_dups_first
# don't display a previously found event
setopt hist_find_no_dups
# delete an old recorded event if a new event is a duplicate
setopt hist_ignore_all_dups
# don't record an event that was just recorded again
setopt hist_ignore_dups
# don't write a duplicate event to the history file
setopt hist_save_no_dups
# don't record an event starting with a space
setopt hist_ignore_space
# don't store history commands
setopt hist_no_store
# remove superfluous blanks from each command line being added to the history list
setopt hist_reduce_blanks
# don't execute immediately upon history expansion
setopt hist_verify
# write to the history file immediately, not when the shell exits
setopt inc_append_history
# share history between all sessions
setopt share_history
