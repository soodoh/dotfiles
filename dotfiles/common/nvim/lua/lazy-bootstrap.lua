local lazy_path = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"

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
