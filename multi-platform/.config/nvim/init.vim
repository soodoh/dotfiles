""""" vim-plug manager
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
" Find and Replace across many files
" TODO
" Plug 'brooth/far.vim'
" Fast Grepping
Plug 'jremmen/vim-ripgrep'
" Keep Window open when closing buffer
Plug 'moll/vim-bbye'
" Tmux Integration
Plug 'christoomey/vim-tmux-navigator'
" Snippets
Plug 'mattn/emmet-vim'
Plug 'mattn/webapi-vim'
" Telescope
" TODO
" Plug 'nvim-lua/popup.vim'
" Plug 'nvim-lua/plenary.nvim'
" Plug 'nvim-telescope/telescope.nvim'
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
Plug 'preservim/nerdtree'
" TODO
" Plug 'kyazdani42/nvim-tree.lua'
" Floating Terminal for fzf & file explorer
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

"""" CoC plugins
" Using this instead of vim-plug allows CoC to auto-update
let g:coc_global_extensions = [
  \'coc-flow',
  \'coc-tsserver',
  \'coc-prettier',
  \'coc-eslint',
  \'coc-css',
  \'coc-html',
  \'coc-json',
  \'coc-yaml',
  \'coc-rls'
  \]

" Snippets
let g:user_emmet_settings = webapi#json#decode(join(readfile(expand('~/.config/nvim/snippets.json')), "\n"))
" Intellisense Bindings
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-definition)

" Add fzf from homebrew to vim path
set rtp+=/usr/local/opt/fzf

"""" Regular vim settings
" fix for mouse in Alacritty
set mouse=a
" set JSON file type to JSONC (allowing comments)
autocmd BufNewFile,BufRead *.json setl ft=jsonc
" enable syntax processing
syntax enable
" number of visual spaces per TAB
set tabstop=2
" number of spaces in tab when editing
set softtabstop=2
" this fixes the auto-indent for auto-close
set shiftwidth=2
" tabs are spaces
set expandtab
" show absolute line numbers
set number
" don't highlight searches
set nohlsearch
" auto toggle between relative/absolute numbers
" augroup numbertoggle
"   autocmd!
"   autocmd BufEnter,FocusGained,InsertLeave * set relativenumber
"   autocmd BufLeave,FocusLost,InsertEnter   * set norelativenumber
" augroup END
"
" highlight current line
set cursorline
" load file-type specific indent files
filetype indent on
" load file-type specific auto commands
filetype plugin on
" highlight matching [{()}]
set showmatch
" search while typing
set incsearch
" backspace is stupid in MacOS
set backspace=indent,eol,start
" searches are case insensitive unless capital letter is used
set ignorecase
set smartcase
" Show - instead of whitespace at end of line
" Also shows ^I instead of tabs
set list

""""" Custom mappings begin here
"
"
""""" This block needs to be update if keyboard layout hjkl directions changes
" Directional Hotkeys
noremap h <Nop>
noremap j h
noremap k j
noremap l k
noremap ' l
noremap <C-w>j <C-w>h
noremap <C-w>k <C-w>j
noremap <C-w>l <C-w>k
noremap <C-w>' <C-w>l
noremap <C-w>J <C-w>H
noremap <C-w>K <C-w>J
noremap <C-w>L <C-w>K
noremap <C-w>" <C-w>L
" Vim-tmux-navigation Directions
let g:tmux_navigator_no_mappings = 1
nnoremap <silent> <C-Left> :TmuxNavigateLeft<CR>
nnoremap <silent> <C-Down> :TmuxNavigateDown<CR>
nnoremap <silent> <C-Up> :TmuxNavigateUp<CR>
nnoremap <silent> <C-Right> :TmuxNavigateRight<CR>

" so that Ctrl+C triggers InsertLeave autocmd
inoremap <C-c> <ESC>
inoremap jk <ESC>
" so that forward delete works in insert mode
inoremap <C-d> <Del>

" Floaterm settings
let g:floaterm_opener = 'edit'

let mapleader=" "
" Buffers
nnoremap <leader>b :ls<CR>:b<space>
nnoremap <silent> <leader>d :Bdelete<CR>
nnoremap <silent> <leader>, :bp<CR>
nnoremap <silent> <leader>. :bn<CR>
nnoremap <silent> <leader>< :BufferMovePrevious<CR>
nnoremap <silent> <leader>> :BufferMoveNext<CR>
" FZF window binding
nnoremap <leader><space> :FloatermNew fzf<CR>
" LF file manager
nnoremap <leader>n :FloatermNew lf<CR>
" NERDTree file manager
noremap <leader>e :NERDTreeToggle<CR>
noremap <leader>ef :NERDTreeFind<CR>
" RipGrep
noremap <leader>f :Rg<space>
let g:rg_command = 'rg --hidden --vimgrep -S'
" Git vim-fugitive hotkeys
noremap <leader>gb :Git blame<CR>
noremap <leader>gd :Gdiff<space>
" GitGutter
let g:gitgutter_highlight_linenrs = 1

" set the theme (must be placed after plugins)
colorscheme nord
" For for colorizer
set termguicolors

" lua init
lua << EOF
-- nvim-colorizer setup (must be placed after plugins)
require 'colorizer'.setup {
  '*';
  css = { css = true }
}

-- lualine status line setup
require'lualine'.setup()
EOF
