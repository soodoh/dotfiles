local M = {}

local modules = {
  "plugins.productivity.which-key",
  "plugins.ui.theme",
  "plugins.productivity.blink-cmp",
  "plugins.lsp.lspconfig",
  "plugins.lsp.lspsaga",
  "plugins.productivity.comment",
  "plugins.productivity.conform",
  "plugins.productivity.diffview",
  "plugins.productivity.flash",
  "plugins.productivity.gitconflict",
  "plugins.productivity.gitlinker",
  "plugins.productivity.gitsigns",
  "plugins.productivity.harpoon",
  "plugins.productivity.nvim-surround",
  "plugins.productivity.nvim-treesitter",
  "plugins.productivity.nvim-ts-autotag",
  "plugins.productivity.nvim-ufo",
  "plugins.productivity.pi",
  "plugins.productivity.telescope",
  "plugins.productivity.trouble",
  "plugins.productivity.yazi",
  "plugins.ui.bufferline",
  "plugins.ui.colorizer",
  "plugins.ui.dashboard",
  "plugins.ui.fidget",
  "plugins.ui.indent",
  "plugins.ui.lualine",
  "plugins.ui.snacks",
}

local setup_modules = {
  ["akinsho/git-conflict.nvim"] = "git-conflict",
  ["catgoose/nvim-colorizer.lua"] = "colorizer",
  ["folke/flash.nvim"] = "flash",
  ["folke/trouble.nvim"] = "trouble",
  ["kevinhwang91/nvim-ufo"] = "ufo",
  ["nvim-treesitter/nvim-treesitter"] = "nvim-treesitter",
  ["nvimdev/lspsaga.nvim"] = "lspsaga",
  ["saghen/blink.cmp"] = "blink.cmp",
  ["stevearc/conform.nvim"] = "conform",
  ["windwp/nvim-ts-autotag"] = "nvim-ts-autotag",
  ["kylechui/nvim-surround"] = "nvim-surround",
}

local function normalize(specs)
  if type(specs) ~= "table" then
    return {}
  end
  if type(specs[1]) == "string" then
    return { specs }
  end
  return specs
end

local function configure(spec)
  if type(spec) ~= "table" then
    return
  end

  if type(spec.init) == "function" then
    spec.init()
  end

  for _, key in ipairs(spec.keys or {}) do
    local lhs = key[1]
    local rhs = key[2]
    if lhs and rhs then
      local modes = key.mode or "n"
      local key_opts = {
        desc = key.desc,
        expr = key.expr,
        noremap = key.noremap ~= false,
        nowait = key.nowait,
        remap = key.remap,
        silent = key.silent ~= false,
      }
      vim.keymap.set(modes, lhs, rhs, key_opts)
    end
  end

  local opts = spec.opts
  if type(opts) == "function" then
    opts = opts()
  end
  opts = opts or {}

  if type(spec.config) == "function" then
    spec.config(nil, opts)
    return
  end

  if spec.config == true or spec.opts ~= nil then
    local module = spec.main or setup_modules[spec[1]]
    if module then
      require(module).setup(opts)
    end
  end
end

function M.setup()
  for _, module in ipairs(modules) do
    local ok, specs = pcall(require, module)
    if not ok then
      vim.notify("Nix plugin config failed to load: " .. module .. ": " .. specs, vim.log.levels.ERROR)
    else
      for _, spec in ipairs(normalize(specs)) do
        local configured, err = pcall(configure, spec)
        if not configured then
          vim.notify("Nix plugin config failed: " .. module .. ": " .. err, vim.log.levels.ERROR)
        end
      end
    end
  end
end

return M
