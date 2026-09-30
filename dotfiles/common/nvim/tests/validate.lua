local plugin_root = vim.fs.joinpath(vim.fn.stdpath("config"), "lua")
for _, path in
  ipairs(vim.fn.globpath(plugin_root, "plugins/**/*.lua", false, true))
do
  local module = path:sub(#plugin_root + 2, -5):gsub("/", ".")
  local ok, err = pcall(require, module)
  if not ok then
    error("plugin config failed to load: " .. module .. ": " .. err)
  end
end

require("lazy").load({ plugins = { "nvim-lspconfig", "conform.nvim" } })

dofile(
  vim.fs.joinpath(
    vim.fs.dirname(vim.env.NVIM_VALIDATE_SCRIPT),
    "typescript-lsp.lua"
  )
)

if vim.treesitter.language.get_lang("jsonc") ~= "json" then
  error("jsonc is not registered to use the JSON Tree-sitter parser")
end

local parsers = require("treesitter-parsers")
for _, parser in ipairs(parsers) do
  local ok = vim.treesitter.language.add(parser)
  if not ok then
    error("Tree-sitter parser failed to load: " .. parser)
  end
end

local missing = {}
local function check_command(command)
  if vim.fn.executable(command) ~= 1 then
    missing[command] = true
  end
end

for _, config in ipairs(vim.lsp.get_configs({ enabled = true })) do
  -- Function-valued commands resolve per workspace; typescript-lsp.lua covers
  -- native/legacy selection without demanding an optional global native server.
  if type(config.cmd) == "table" then
    check_command(config.cmd[1])
  end
end

for _, formatter in ipairs(require("conform").list_all_formatters()) do
  -- A blank validation buffer has no project root. Still reject unavailable
  -- executables or malformed formatter definitions, including new formatters.
  if
    not formatter.available
    and formatter.available_msg ~= "Root directory not found"
  then
    error(
      "formatter unavailable: "
        .. formatter.name
        .. ": "
        .. (formatter.available_msg or "unknown")
    )
  end
end

-- Non-LSP/formatter integrations still require these command-line interfaces.
for _, command in ipairs({ "rg", "git", "yazi" }) do
  check_command(command)
end
if next(missing) then
  error(
    "missing Neovim executables: "
      .. table.concat(vim.tbl_keys(missing), ", ")
  )
end
