-- Automatically install Packer, if not already
local fn = vim.fn
local install_path = fn.stdpath('data')..'/site/pack/packer/start/packer.nvim'
local packer_bootstrap = false
if fn.empty(fn.glob(install_path)) > 0 then
  packer_bootstrap = fn.system({'git', 'clone', '--depth', '1', 'https://github.com/wbthomason/packer.nvim', install_path})
end

vim.cmd([[packadd packer.nvim]])
local packer = require('packer')

return packer.startup(function(use)
  -- TODO unsure if this is worth the effort
  -- Text Navigation
  -- use 'unblevable/quick-scope'
  -- Easymotion
  -- use 'easymotion/vim-easymotion'

  use 'sheerun/vim-polyglot' -- Better syntax highlighing
  use 'suy/vim-context-commentstring' -- Useful for React commenting
  use 'tpope/vim-commentary' -- Better commenting
  use 'tpope/vim-surround' -- Surround text objects with {[()]}
  use 'AndrewRadev/tagalong.vim' -- Auto change HTML tags
  use 'moll/vim-bbye' -- Keep windows open when closing buffer
  use 'christoomey/vim-tmux-navigator' -- Tmux Integration
  use 'psliwka/vim-smoothie' -- Smooth scrolling
  use 'kyazdani42/nvim-web-devicons' -- Cool icons
  -- Better buffer tab line
  use {
    'akinsho/bufferline.nvim',
    config = function()
      require('bufferline').setup()
    end
  }
  use {
    'windwp/nvim-autopairs',
    config = function()
      require('nvim-autopairs').setup()
    end
  }
  -- Floating terminal for LF file explorer
  use {
    'voldikss/vim-floaterm',
    setup = function()
      vim.g.floaterm_opener = 'edit'
    end,
  }

  -- Git Integration
  use 'tpope/vim-fugitive'
  use 'junegunn/gv.vim'
  use 'rhysd/git-messenger.vim'
  use {
    'lewis6991/gitsigns.nvim',
    requires = { 'nvim-lua/plenary.nvim' },
    config = function()
      require('gitsigns').setup({
        current_line_blame = true,
      })
    end
  }

  -- Emmet/Snippets
  use {
    'mattn/emmet-vim',
    requires = { 'mattn/webapi-vim' },
    config = function()
      vim.cmd([[
        let g:user_emmet_settings = webapi#json#decode(join(readfile(expand('~/.config/nvim/snippets.json')), "\n"))
      ]])
    end
  }

  -- Telescope
  use {
    'nvim-telescope/telescope.nvim',
    requires = { 'nvim-lua/plenary.nvim' },
    config = require('configs._telescope')
  }

  -- Nvim Tree file explorer
  use {
    'kyazdani42/nvim-tree.lua',
    requires = { 'kyazdani42/nvim-web-devicons' },
    config = require('nvim-tree').setup({})
  }

  -- Color hex codes
  use {
    'norcalli/nvim-colorizer.lua',
    config = require('configs._colorizer')
  }
  -- Treesitter (LSP-based syntax highlighting)
  use {
    'nvim-treesitter/nvim-treesitter',
    run = ':TSUpdate',
    requires = { 'p00f/nvim-ts-rainbow' },
    config = require('configs.treesitter')
  }

  -- Intellisense
  use {
    'neovim/nvim-lspconfig',
    requires = {
      'williamboman/nvim-lsp-installer',
      'jose-elias-alvarez/null-ls.nvim',
      'jose-elias-alvarez/nvim-lsp-ts-utils'
    },
    config = require('configs.lsp')
  }
  use {
    'hrsh7th/nvim-cmp',
    requires = {
      'hrsh7th/cmp-nvim-lsp',
      'onsails/lspkind-nvim', -- Adds icons to autocompletion menu
      -- cmp requires a snippet engine
      -- For vsnip users.
      'hrsh7th/cmp-vsnip',
      'hrsh7th/vim-vsnip',
      -- For luasnip users.
      -- 'L3MON4D3/LuaSnip',
      -- 'saadparwaiz1/cmp_luasnip',
      -- For ultisnips users.
      -- 'SirVer/ultisnips',
      -- 'quangnguyen30192/cmp-nvim-ultisnips',
      -- For snippy users.
      -- 'dcampos/nvim-snippy',
      -- 'dcampos/cmp-snippy',
    },
    config = function()
      require('configs.autocomplete')
    end
  }
  -- use 'glepnir/lspaga.nvim'
  -- use 'mfussenegger/nvim-dap'

  -- Markdown Preview
  use {
    'iamcco/markdown-preview.nvim',
    run = 'cd app && npm install'
  }
  -- Status Line
  use {
    'nvim-lualine/lualine.nvim',
    requires = { 'kyazdani42/nvim-web-devicons' },
    config = function()
      require('lualine').setup()
    end
  }
  -- Color schemes
  use {
    'NLKNguyen/papercolor-theme',
    config = function()
      vim.cmd('colorscheme papercolor')
    end
  }

  use 'wbthomason/packer.nvim' -- Packer manages itself!
  -- Automatically set up your configuration after cloning packer.nvim
  -- Put this at the end after all plugins
  if packer_bootstrap then
    require('packer').sync()
  end
end)
