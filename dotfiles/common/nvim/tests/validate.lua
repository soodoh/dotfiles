local modules = {
  "plugins.lsp.lspconfig",
  "plugins.lsp.lspsaga",
  "plugins.productivity.blink-cmp",
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
  "plugins.productivity.which-key",
  "plugins.productivity.yazi",
  "plugins.ui.bufferline",
  "plugins.ui.colorizer",
  "plugins.ui.dashboard",
  "plugins.ui.fidget",
  "plugins.ui.indent",
  "plugins.ui.lualine",
  "plugins.ui.snacks",
  "plugins.ui.theme",
}
for _, module in ipairs(modules) do
  local ok, err = pcall(require, module)
  if not ok then
    error("plugin config failed to load: " .. module .. ": " .. err)
  end
end

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
local commands = {
  "awk-language-server", "bash-language-server", "biome", "docker-language-server", "gopls",
  "graphql-lsp", "lua-language-server", "marksman", "oxlint", "prisma-language-server",
  "pyright-langserver", "ruff", "rust-analyzer", "taplo", "typescript-language-server",
  "vim-language-server", "vscode-css-language-server", "vscode-html-language-server",
  "vscode-json-language-server", "vscode-eslint-language-server", "yaml-language-server", "eslint_d",
  "kdlfmt", "prettier", "shellcheck", "shfmt", "stylua", "yamllint", "rg", "git", "yazi", "tmux",
}
local missing = {}
for _, command in ipairs(commands) do
  if vim.fn.executable(command) ~= 1 then
    table.insert(missing, command)
  end
end
if #missing > 0 then
  error("missing Neovim executables: " .. table.concat(missing, ", "))
end
