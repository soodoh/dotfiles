local lazy_path = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
local lazy_commit = "26d121ea13bee96b079403cee6598f04969d4983"

if not vim.uv.fs_stat(lazy_path) then
  local output = vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    lazy_path,
  })
  if vim.v.shell_error ~= 0 then
    error("failed to clone lazy.nvim:\n" .. output)
  end
end

local current_commit = vim.fn.system({ "git", "-C", lazy_path, "rev-parse", "HEAD" }):gsub("%s+$", "")
if current_commit ~= lazy_commit then
  local output = vim.fn.system({ "git", "-C", lazy_path, "fetch", "origin", lazy_commit })
  if vim.v.shell_error ~= 0 then
    error("failed to fetch pinned lazy.nvim commit:\n" .. output)
  end
  output = vim.fn.system({ "git", "-C", lazy_path, "checkout", "--detach", lazy_commit })
  if vim.v.shell_error ~= 0 then
    error("failed to check out pinned lazy.nvim commit:\n" .. output)
  end
end

vim.opt.rtp:prepend(lazy_path)
require("lazy").setup({
  spec = {
    { import = "plugins.lsp" },
    { import = "plugins.productivity" },
    { import = "plugins.ui" },
  },
  change_detection = { notify = false },
  checker = { enabled = false },
  install = { colorscheme = { "tokyonight" } },
  lockfile = vim.fn.stdpath("config") .. "/lazy-lock.json",
})
