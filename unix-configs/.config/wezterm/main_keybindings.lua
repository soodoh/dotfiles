local wezterm = require("wezterm")

return {
	apply_to_config = function(config)
		config.disable_default_key_bindings = true
		config.leader = { key = "g", mods = "CTRL", timeout_milliseconds = 1000 }
		config.mouse_bindings = {
			-- Ctrl-click will open the link under the mouse cursor
			{
				event = { Up = { streak = 1, button = "Left" } },
				mods = "CTRL",
				action = wezterm.action.OpenLinkAtMouseCursor,
			},
		}

		-- Typical OS keybindings
		table.insert(config.keys, { key = "c", mods = "SUPER", action = wezterm.action.CopyTo("Clipboard") })
		table.insert(config.keys, { key = "v", mods = "SUPER", action = wezterm.action.PasteFrom("Clipboard") })
		table.insert(config.keys, { key = "n", mods = "SUPER", action = wezterm.action.SpawnWindow })
		table.insert(config.keys, { key = "q", mods = "SUPER", action = wezterm.action.QuitApplication })
		table.insert(config.keys, { key = "w", mods = "SUPER", action = wezterm.action.QuitApplication })
		table.insert(config.keys, { key = "m", mods = "SUPER", action = wezterm.action.Hide })

		-- Copy and Search modes
		table.insert(config.keys, { key = "Enter", mods = "LEADER", action = wezterm.action.ActivateCopyMode })
		table.insert(config.key_tables.copy_mode, {
			key = "/",
			action = wezterm.action.Search("CurrentSelectionOrEmptyString"),
		})
		table.insert(config.key_tables.copy_mode, {
			key = "u",
			action = wezterm.action.ScrollByPage(-0.5),
		})
		table.insert(config.key_tables.copy_mode, {
			key = "d",
			action = wezterm.action.ScrollByPage(0.5),
		})
		table.insert(config.key_tables.search_mode, {
			key = "Escape",
			action = wezterm.action.Multiple({
				wezterm.action.CopyMode("ClearPattern"),
				wezterm.action.CopyMode("AcceptPattern"),
				wezterm.action.CopyMode({ SetSelectionMode = "Cell" }),
			}),
		})

		-- Other
		table.insert(config.keys, { key = "u", mods = "ALT", action = wezterm.action.ScrollByPage(-0.5) })
		table.insert(config.keys, { key = "d", mods = "ALT", action = wezterm.action.ScrollByPage(0.5) })
	end,
}
