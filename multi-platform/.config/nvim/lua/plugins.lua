local fn = vim.fn

-- Bootstrap packer, if not already installed
local install_path = fn.stdpath("data") .. "/site/pack/packer/start/packer.nvim"
local packer_bootstrap = false
if fn.empty(fn.glob(install_path)) > 0 then
    packer_bootstrap = fn.system({
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
    use("sheerun/vim-polyglot") -- Better syntax highlighing (fallback for treesitter)
    use("tpope/vim-surround") -- Surround text objects with {[()]}
    use({
        "phaazon/hop.nvim",
        branch = "v1", -- optional but strongly recommended
        config = require("configs.hop-config"),
    })
    use({
        "numToStr/Comment.nvim",
        config = require("configs.comment-config"),
    })
    -- Show line indents
    use({
        "Yggdroot/indentLine",
        config = function()
            vim.g.indentLine_fileTypeExclude = { "dashboard", "markdown" }
        end,
    })
    use("AndrewRadev/tagalong.vim") -- Auto change HTML tags
    -- Keep windows open when closing buffer
    use({
        "moll/vim-bbye",
        config = function()
            local keymap = require("utils").keymap
            keymap("n", "<leader>d", ":Bdelete<CR>")
        end,
    })
    use({
        "christoomey/vim-tmux-navigator",
        config = function()
            vim.g.tmux_navigator_no_mappings = 1
            local keymap = require("utils").keymap
            keymap("n", "<C-h>", ":TmuxNavigateLeft<CR>")
            keymap("n", "<C-j>", ":TmuxNavigateDown<CR>")
            keymap("n", "<C-k>", ":TmuxNavigateUp<CR>")
            keymap("n", "<C-l>", ":TmuxNavigateRight<CR>")
        end,
    })
    use("psliwka/vim-smoothie") -- Smooth scrolling
    use("kyazdani42/nvim-web-devicons") -- Cool icons
    -- Better buffer tab line
    use({
        "akinsho/bufferline.nvim",
        tag = "*",
        requires = "kyazdani42/nvim-web-devicons",
        config = require("configs.bufferline-config"),
    })
    use({
        "windwp/nvim-autopairs",
        config = function()
            require("nvim-autopairs").setup()
        end,
    })
    -- Floating terminal for LF file explorer
    use({
        "voldikss/vim-floaterm",
        setup = function()
            vim.g.floaterm_opener = "edit"
        end,
        config = function()
            --   -- LF file manager
            local keymap = require("utils").keymap
            keymap("n", "<leader>e", ":FloatermNew lf<CR>")
        end,
    })

    -- Git Integration
    use({
        "tpope/vim-fugitive",
        config = function()
            local keymap = require("utils").keymap
            keymap("n", "<leader>gb", ":Git blame<CR>", { noremap = true })
            keymap("n", "<leader>gd", ":Gdiff HEAD^<CR>", { noremap = true })
        end,
    })
    use("junegunn/gv.vim")
    use("rhysd/git-messenger.vim")
    use({
        "lewis6991/gitsigns.nvim",
        requires = { "nvim-lua/plenary.nvim" },
        config = require("configs.gitsigns-config"),
    })

    -- Emmet/Snippets
    use({
        "mattn/emmet-vim",
        requires = { "mattn/webapi-vim" },
        config = function()
            vim.cmd([[
        let g:user_emmet_settings = webapi#json#decode(join(readfile(expand('~/.config/nvim/snippets.json')), "\n"))
      ]])
        end,
    })

    use({
        "folke/trouble.nvim",
        requires = "kyazdani42/nvim-web-devicons",
        config = require("configs.trouble-config"),
    })
    -- Telescope
    use({ "nvim-telescope/telescope-fzf-native.nvim", run = "make" })
    use({
        "nvim-telescope/telescope.nvim",
        requires = {
            "nvim-lua/plenary.nvim",
            "nvim-telescope/telescope-live-grep-raw.nvim",
            "nvim-telescope/telescope-fzf-native.nvim",
            "folke/trouble.nvim",
        },
        config = require("configs.telescope-config"),
    })

    -- Nvim Tree file explorer
    use({
        "kyazdani42/nvim-tree.lua",
        requires = { "kyazdani42/nvim-web-devicons" },
        config = function()
            require("nvim-tree").setup({})
            local keymap = require("utils").keymap
            keymap("n", "<leader>nn", ":NvimTreeToggle<CR>")
            keymap("n", "<leader>nf", ":NvimTreeFindFile<CR>")
        end,
    })

    -- Color hex codes
    use({
        "norcalli/nvim-colorizer.lua",
        config = require("configs.colorizer-config"),
    })
    -- Treesitter (LSP-based syntax highlighting)
    use({
        "nvim-treesitter/nvim-treesitter",
        run = ":TSUpdate",
        requires = { "p00f/nvim-ts-rainbow" },
        config = require("configs.treesitter-config"),
    })

    -- Intellisense
    use({
        "neovim/nvim-lspconfig",
        requires = {
            "williamboman/nvim-lsp-installer",
            -- Autocomplete stuff
            "hrsh7th/nvim-cmp",
            "hrsh7th/cmp-nvim-lsp",
        },
        config = require("configs.lsp"),
    })
    use({
        "hrsh7th/nvim-cmp",
        requires = {
            "hrsh7th/cmp-nvim-lsp",
            "hrsh7th/cmp-buffer",
            "hrsh7th/cmp-path",
            "hrsh7th/cmp-cmdline",
            "onsails/lspkind-nvim", -- Adds icons to autocompletion menu
            -- cmp requires a snippet engine
            "hrsh7th/cmp-vsnip",
            "hrsh7th/vim-vsnip",
        },
        config = require("configs.nvim-cmp-config"),
    })
    use({
        "jose-elias-alvarez/null-ls.nvim",
        requires = { "nvim-lua/plenary.nvim" },
        config = require("configs.lsp.null-ls-config"),
    })
    use({
        -- "glepnir/lspsaga.nvim",
        "tami5/lspsaga.nvim",
        config = require("configs.lspsaga-config"),
    })
    -- use({
    --     "glepnir/dashboard-nvim",
    --     config = require("configs.dashboard-config"),
    -- })
    -- use 'mfussenegger/nvim-dap'

    -- Status Line
    use({
        "nvim-lualine/lualine.nvim",
        requires = { "kyazdani42/nvim-web-devicons" },
        config = function()
            require("lualine").setup()
        end,
    })
    -- Color schemes
    use({
        "folke/tokyonight.nvim",
        config = require("configs.colorscheme-config"),
    })

    use("wbthomason/packer.nvim") -- Packer manages itself!
    -- Automatically set up your configuration after cloning packer.nvim
    -- Put this at the end after all plugins
    if packer_bootstrap then
        require("packer").sync()
    end
end)
