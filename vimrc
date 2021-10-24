""""" vim-plug manager
call plug#begin('~/.config/nvim/plugged')
" Developer Features
Plug 'tpope/vim-surround'
Plug 'scrooloose/nerdcommenter'
Plug 'tpope/vim-fugitive'
Plug 'preservim/nerdtree'
Plug 'jremmen/vim-ripgrep'
Plug 'moll/vim-bbye'
Plug 'christoomey/vim-tmux-navigator'
Plug 'norcalli/nvim-colorizer.lua'
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'voldikss/vim-floaterm'

" Syntax Highlighting
Plug 'sheerun/vim-polyglot'

" UI Enhancements
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'ryanoasis/vim-devicons'
" Color schemes
Plug 'arcticicestudio/nord-vim'
call plug#end()

"""" CoC plugins
" Using this instead of vim-plug allows CoC to auto-update
let g:coc_global_extensions = [
  \'coc-flow',
  \'coc-snippets',
  \'coc-git',
  \'coc-tsserver',
  \'coc-prettier',
  \'coc-eslint',
  \'coc-css',
  \'coc-html',
  \'coc-json',
  \'coc-yaml',
  \'coc-rls'
  \]

" Coc.nvim Intellisense Settings
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-definition)
noremap <leader>ue :CocCommand snippets.editSnippets<CR>
imap <C-l> <Plug>(coc-snippets-expand-jump)

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
" auto toggle between relative/absolute numbers
augroup numbertoggle
  autocmd!
  autocmd BufEnter,FocusGained,InsertLeave * set relativenumber
  autocmd BufLeave,FocusLost,InsertEnter   * set norelativenumber
augroup END
" highlight current line
set cursorline
" load file-type specific indent files
filetype indent on
" load file-type specific auto commands
filetype plugin on
" highlight matching [{()}]
set showmatch
" highlight matches
set hlsearch
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
let mapleader=","
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
" Buffers
nnoremap <leader>b :ls<CR>:b<space>
nnoremap <leader>bd :Bdelete<CR>

" so that Ctrl+C triggers InsertLeave autocmd
inoremap <C-c> <ESC>
inoremap jk <ESC>
" so that forward delete works in insert mode
inoremap <C-d> <Del>
" other mappings 
noremap <leader>hl :nohlsearch<CR>

" Easier sorting
noremap <leader>!s :!sort<CR>
noremap <leader>s :sort<CR>

" Floaterm settings
let g:floaterm_opener = 'edit'
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

" NERD commenter settings
let g:NERDSpaceDelims = 1
" Align line-wise comment delimiters flush left instead of following code indentation
let g:NERDDefaultAlign = 'left'

" air-line Status Line
let g:airline#extensions#tabline#enabled = 1
let g:airline_powerline_fonts = 1

" set the theme (must be placed after plugins)
colorscheme nord
" For for colorizer
set termguicolors
" nvim-colorizer setup (must be placed after plugins)
lua << EOF
require 'colorizer'.setup {
  '*';
  css = { css = true }
}
EOF
