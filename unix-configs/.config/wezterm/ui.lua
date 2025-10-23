local wezterm = require("wezterm")

return {
	apply_to_config = function(config)
		config.window_decorations = "RESIZE"
		config.window_padding = {
			left = 5,
			right = 5,
			top = 5,
			bottom = 5,
		}

		config.window_background_opacity = 0.8
		config.macos_window_background_blur = 15
		-- config.colors = { background = "black" }
		config.color_scheme = "tokyonight_night"
		config.font = wezterm.font("FiraCode Nerd Font Mono")
		config.font_size = 18.0

		config.use_fancy_tab_bar = false
		config.tab_bar_at_bottom = true
	end,
}
