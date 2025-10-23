local wezterm = require("wezterm")
local config = wezterm.config_builder()

local workspace_switcher = wezterm.plugin.require("https://github.com/MLFlexer/smart_workspace_switcher.wezterm")
local tabline = require("tabline")
tabline.apply_to_config(config)

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
-- config.colors = { background = "black" }
config.color_scheme = "tokyonight_night"
config.font = wezterm.font("FiraCode Nerd Font Mono")
config.font_size = 18.0

config.use_fancy_tab_bar = false
config.tab_bar_at_bottom = true
config.show_new_tab_button_in_tab_bar = false
-- config.show_close_tab_button_in_tabs = true

config.unix_domains = {
	{ name = "unix" },
}
config.ssh_domains = {
	{
		name = "proxmox",
		remote_address = "192.168.0.123",
		username = "root",
	},
	{
		name = "docker",
		remote_address = "192.168.0.100",
		username = "docker",
	},
}
config.default_gui_startup_args = { "connect", "unix" }
config.default_workspace = "~"

local switch_previous = wezterm.action_callback(function(window, pane)
	local tab = window:mux_window():active_tab()
	if tab:get_pane_direction("Left") ~= nil then
		window:perform_action(wezterm.action.ActivatePaneDirection("Left"), pane)
	else
		window:perform_action(wezterm.action.ActivateTabRelative(-1), pane)
	end
end)
local switch_next = wezterm.action_callback(function(window, pane)
	local tab = window:mux_window():active_tab()
	if tab:get_pane_direction("Right") ~= nil then
		window:perform_action(wezterm.action.ActivatePaneDirection("Right"), pane)
	else
		window:perform_action(wezterm.action.ActivateTabRelative(1), pane)
	end
end)

config.mouse_bindings = {
	-- Ctrl-click will open the link under the mouse cursor
	{
		event = { Up = { streak = 1, button = "Left" } },
		mods = "CTRL",
		action = wezterm.action.OpenLinkAtMouseCursor,
	},
}

config.leader = { key = "g", mods = "CTRL", timeout_milliseconds = 1000 }

config.keys = {
	-- Typical OS keybindings
	{ key = "c", mods = "SUPER", action = wezterm.action.CopyTo("Clipboard") },
	{ key = "v", mods = "SUPER", action = wezterm.action.PasteFrom("Clipboard") },
	{ key = "n", mods = "SUPER", action = wezterm.action.SpawnWindow },
	{ key = "q", mods = "SUPER", action = wezterm.action.QuitApplication },
	{ key = "w", mods = "SUPER", action = wezterm.action.QuitApplication },
	{ key = "m", mods = "SUPER", action = wezterm.action.Hide },

	-- Other
	{ key = "Enter", mods = "LEADER", action = wezterm.action.ActivateCopyMode },
	{ key = "u", mods = "ALT", action = wezterm.action.ScrollByPage(-0.5) },
	{ key = "d", mods = "ALT", action = wezterm.action.ScrollByPage(0.5) },

	-- Tab management
	{ key = "x", mods = "ALT", action = wezterm.action.CloseCurrentPane({ confirm = false }) },
	{ key = "t", mods = "ALT", action = wezterm.action.SpawnTab("CurrentPaneDomain") },
	{ key = "n", mods = "ALT", action = wezterm.action.SpawnTab("CurrentPaneDomain") },
	{ key = "i", mods = "ALT", action = wezterm.action.MoveTabRelative(-1) },
	{ key = "o", mods = "ALT", action = wezterm.action.MoveTabRelative(1) },
	{
		key = "s",
		mods = "ALT",
		action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }),
	},
	{
		key = "v",
		mods = "ALT",
		action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
	},

	-- Pane Management
	{
		key = "LeftArrow",
		mods = "ALT",
		action = switch_previous,
	},
	{
		key = "h",
		mods = "ALT",
		action = switch_previous,
	},
	{
		key = "RightArrow",
		mods = "ALT",
		action = switch_next,
	},
	{
		key = "l",
		mods = "ALT",
		action = switch_next,
	},
	{
		key = "UpArrow",
		mods = "ALT",
		action = wezterm.action.ActivatePaneDirection("Up"),
	},
	{
		key = "k",
		mods = "ALT",
		action = wezterm.action.ActivatePaneDirection("Up"),
	},
	{
		key = "DownArrow",
		mods = "ALT",
		action = wezterm.action.ActivatePaneDirection("Down"),
	},
	{
		key = "j",
		mods = "ALT",
		action = wezterm.action.ActivatePaneDirection("Down"),
	},
	{ key = "z", mods = "LEADER", action = wezterm.action.TogglePaneZoomState },

	-- Session management
	{
		key = "w",
		mods = "ALT",
		action = workspace_switcher.switch_workspace(),
	},
	{
		key = "W",
		mods = "ALT",
		action = workspace_switcher.switch_workspace(),
	},
	{ key = "Tab", mods = "ALT", action = workspace_switcher.switch_to_prev_workspace() },
	{ key = "d", mods = "LEADER", action = wezterm.action.DetachDomain("CurrentPaneDomain") },
}

return config
