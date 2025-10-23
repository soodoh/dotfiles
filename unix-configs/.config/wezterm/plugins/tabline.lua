local wezterm = require("wezterm")
local tabline = wezterm.plugin.require("https://github.com/michaelbrusegard/tabline.wez")

tabline.setup({
	options = {
		icons_enabled = true,
		theme = "tokyonight_night",
		tabs_enabled = true,
		theme_overrides = {},
		section_separators = {
			left = wezterm.nerdfonts.pl_left_hard_divider,
			right = wezterm.nerdfonts.pl_right_hard_divider,
		},
		component_separators = {
			left = wezterm.nerdfonts.pl_left_soft_divider,
			right = wezterm.nerdfonts.pl_right_soft_divider,
		},
		tab_separators = {
			left = wezterm.nerdfonts.pl_left_hard_divider,
			right = wezterm.nerdfonts.pl_right_hard_divider,
		},
	},
	sections = {
		tabline_a = { { "domain", icons_only = true, padding = { left = 1, right = 0 } } },
		tabline_b = { "workspace" },
		tabline_c = { " " },
		tab_active = {
			"index",
			{ "process", padding = { left = 0, right = 1 } },
			{ "zoomed", padding = 0 },
		},
		tab_inactive = { "index", { "process", padding = { left = 0, right = 1 } } },
		tabline_x = { { "datetime", style = "%H:%M" } },
		tabline_y = {
			{
				"datetime",
				style = " %a %m/%d",
				icons_enabled = false,
				-- icon = wezterm.nerdfonts.fa_calendar,
				-- hour_to_icon = nil,
			},
			"battery",
		},
		tabline_z = { "hostname" },
	},
	extensions = { "quick_domains" },
})

return tabline
