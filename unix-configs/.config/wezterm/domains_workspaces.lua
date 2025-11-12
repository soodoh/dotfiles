local wezterm = require("wezterm")

return {
	apply_to_config = function(config)
		-- Use "unix" for tmux-like persistent session, rather than "local" default
		config.unix_domains = {
			{ name = "main" },
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

		-- Default workspace only works on local domain
		config.default_workspace = "~"
		config.default_domain = "main"
		-- Automatically connect to "unix" domain on startup
		-- (like auto-starting tmux)
		-- config.default_gui_startup_args = { "connect", "main" }

		-- Related keybindings
		table.insert(
			config.keys,
			{ key = "d", mods = "LEADER", action = wezterm.action.DetachDomain("CurrentPaneDomain") }
		)
		table.insert(config.keys, {
			key = "w",
			mods = "LEADER",
			action = wezterm.action.ShowLauncherArgs({ title = "Connect to Domain", flags = "FUZZY|DOMAINS" }),
		})
	end,
}
