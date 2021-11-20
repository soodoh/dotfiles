vim.cmd([[
call plug#begin('~/.config/nvim/plugged')
" TODO unsure if these are worth the effort
" Text Navigation 
" Plug 'unblevable/quick-scope'
" Easymotion
" Plug 'easymotion/vim-easymotion'

" TODO after LSP is set up
" Treesitter (LSP-based syntax highlighting)
" Plug 'nvim-treesitter/nvim-treesitter'
" Plug 'p00f/nvim-ts-rainbow'

" Better Syntax Highlighting
Plug 'sheerun/vim-polyglot'
" Comment/Uncomment
Plug 'tpope/vim-commentary'
" Useful for React Commenting
Plug 'suy/vim-context-commentstring'
" Auto pairs for ([{
Plug 'jiangmiao/auto-pairs'
" Surround text objects with a character {([])}
Plug 'tpope/vim-surround'
" Auto change HTML tags
Plug 'AndrewRadev/tagalong.vim'
" Git Integration
Plug 'tpope/vim-fugitive'
Plug 'junegunn/gv.vim'
Plug 'airblade/vim-gitgutter'
Plug 'rhysd/git-messenger.vim'
" Keep Window open when closing buffer
Plug 'moll/vim-bbye'
" Tmux Integration
Plug 'christoomey/vim-tmux-navigator'
" Snippets
Plug 'mattn/emmet-vim'
Plug 'mattn/webapi-vim'
" Telescope
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'
" Intellisense
Plug 'neoclide/coc.nvim', {'branch': 'release'}
" TODO
" Plug 'neovim/nvim-lspconfig'
" Plug 'hrsh7th/nvim-compe'
" Plug 'glepnir/lspaga.nvim'
" Plug 'onsails/lspkind-nvim'
" Plug 'kosayoda/nvim-lightbulb'
" Plug 'mfussenegger/nvim-jdtls'
" Plug 'mfussenegger/nvim-dap'
" Color hex codes
Plug 'norcalli/nvim-colorizer.lua'
" File Tree Explorer
Plug 'kyazdani42/nvim-tree.lua'
" Floating Terminal for file explorer
Plug 'voldikss/vim-floaterm'
" Smooth Scrolling
Plug 'psliwka/vim-smoothie'
" Markdown Preview
Plug 'iamcco/markdown-preview.nvim', { 'do': 'cd app & npm install' }
" Cool Icons
Plug 'kyazdani42/nvim-web-devicons' "lua
Plug 'ryanoasis/vim-devicons' " vimscript
" Status Line
Plug 'nvim-lualine/lualine.nvim'
" Better Tab Line
Plug 'romgrk/barbar.nvim'
" Color schemes
Plug 'arcticicestudio/nord-vim'
call plug#end()
]])

require'lualine'.setup()
require'nvim-tree'.setup()
require'telescope'.setup {
  defaults = {
    file_ignore_patterns = { 'node_modules', '.git' },
    vimgrep_arguments = {
      'rg',
      '--color=never',
      '--no-heading',
      '--with-filename',
      '--line-number',
      '--column',
      '--smart-case',
      '--hidden'
    }
  }
}

vim.opt.termguicolors = true -- so colorizer works
require'colorizer'.setup {
  '*';
  css = { css = true }
}

-- CoC plugins
-- this instead of vim-plug allows CoC to auto-update
vim.g.coc_global_extensions = {
  'coc-flow',
  'coc-tsserver',
  'coc-prettier',
  'coc-eslint',
  'coc-css',
  'coc-html',
  'coc-json',
  'coc-yaml',
  'coc-rls'
}

-- Snippets
vim.cmd([[
  let g:user_emmet_settings = webapi#json#decode(join(readfile(expand('~/.config/nvim/snippets.json')), "\n"))
]])
-- Floaterm for LF file explorer
vim.g.floaterm_opener = 'edit'
-- GitGutter
vim.g.gitgutter_highlight_linenrs = 1

