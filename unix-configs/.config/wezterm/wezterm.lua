local wezterm = require("wezterm")
local config = wezterm.config_builder()
-- Setup table so modules can insert to it
config.keys = {}

-- Split up settings into relevant modules
local common = require("common")
common.apply_to_config(config)
local domains_workspaces = require("domains_workspaces")
domains_workspaces.apply_to_config(config)
local panes_tabs = require("panes_tabs")
panes_tabs.apply_to_config(config)
local ui = require("ui")
ui.apply_to_config(config)

local plugins = require("plugins")
plugins.apply_to_config(config)

return config
