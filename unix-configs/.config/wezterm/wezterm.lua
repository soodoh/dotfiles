local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- Setup table so modules can insert to it
config.keys = {}
local default_key_tables = wezterm.gui.default_key_tables()
config.key_tables = {
	copy_mode = default_key_tables.copy_mode,
	search_mode = default_key_tables.search_mode,
}

local main_keybindings = require("main_keybindings")
main_keybindings.apply_to_config(config)

local domains_workspaces = require("domains_workspaces")
domains_workspaces.apply_to_config(config)

local panes_tabs = require("panes_tabs")
panes_tabs.apply_to_config(config)

local ui = require("ui")
ui.apply_to_config(config)

local plugins = require("plugins")
plugins.apply_to_config(config)

return config
