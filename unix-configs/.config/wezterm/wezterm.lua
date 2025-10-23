local wezterm = require("wezterm")
local config = wezterm.config_builder()

config.disable_default_key_bindings = true
config.window_decorations = "RESIZE"
config.window_padding = {
	left = 5,
	right = 5,
	top = 5,
	bottom = 5,
}

config.window_background_opacity = 0.8
config.macos_window_background_blur = 15
config.colors = { background = "black" }
config.color_scheme = "tokyonight_night"
config.font = wezterm.font("FiraCode Nerd Font Mono")
config.font_size = 18.0

config.use_fancy_tab_bar = false
config.tab_bar_at_bottom = true
config.show_new_tab_button_in_tab_bar = false
-- config.show_close_tab_button_in_tabs = true

config.keys = {
	{ key = "c", mods = "SUPER", action = wezterm.action.CopyTo("Clipboard") },
	{ key = "v", mods = "SUPER", action = wezterm.action.PasteFrom("Clipboard") },
	{ key = "n", mods = "SUPER", action = wezterm.action.SpawnWindow },
	{ key = "q", mods = "SUPER", action = wezterm.action.QuitApplication },
	{ key = "c", mods = "ALT", action = wezterm.action.ActivateCopyMode },
}

return config
