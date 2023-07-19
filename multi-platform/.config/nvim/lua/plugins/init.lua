local install_path = vim.fn.stdpath("data")
    .. "/site/pack/packer/start/packer.nvim"
local packer_bootstrap = false
if vim.fn.empty(vim.fn.glob(install_path)) > 0 then
    packer_bootstrap = vim.fn.system({
        "git",
        "clone",
        "--depth",
        "1",
        "https://github.com/wbthomason/packer.nvim",
        install_path,
    })
end
-- Set up package manager
vim.cmd([[packadd packer.nvim]])
local packer = require("packer")

return packer.startup(function(use)
    require("plugins.ui")(use)
    require("plugins.editor")(use)
    require("plugins.lsp")(use)

    -- Packer manages itself!
    use("wbthomason/packer.nvim")
    -- Automatically set up your configuration after cloning packer.nvim
    -- Put this at the end after all plugins
    if packer_bootstrap then
        require("packer").sync()
    end
end)
