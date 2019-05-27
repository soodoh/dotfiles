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
" show line numbers
set number
" highlight current line
set cursorline
" load file-type specific indent files
filetype indent on
" load file-type specific auto commands
filetype plugin on
" redraw only when we need to
set lazyredraw
" highlight matching [{()}]
set showmatch
" highlight matches
set hlsearch
" search while typing
set incsearch
" backspace is stupid in MacOS
set backspace=indent,eol,start
" so that forward delete works in insert mode
" inoremap <C-d> <Esc>lxi
inoremap <C-d> <Del>

" maps <leader> key
let mapleader=","
" maps :nohlsearch command to ,<space>
noremap <leader>hl :nohlsearch<CR>
" remap for running fzf
noremap <leader><space> :Files<CR>
" remap for toggling NERDTree
noremap <leader>b :NERDTreeToggle<CR>
" remap for Ag silver searcher
noremap <leader>f :Ag<CR>
" remap for Git Blame
noremap <leader>gb :Gblame<CR>

" Grep Settings
set grepprg=ag\ --vimgrep\ $*
set grepformat=%f:%l:%c:%m

" NERD commenter settings
let g:NERDSpaceDelims = 1

" Linting settings
let g:ale_fixers = {
  \ 'javascript': ['prettier', 'eslint']
  \ }
let g:ale_linters = {
  \ 'javascript': ['eslint']
  \ }
let g:ale_sign_error='❌'
let g:ale_sign_warning='⚠️ '
let g:ale_fix_on_save = 1 " Auto-fix on save
highlight ALEErrorSign ctermbg=NONE ctermfg=red
highlight ALEWarningSign ctermbg=NONE ctermfg=yellow

" Coc.nvim Intellisense Settings
nmap <silent> <leader>dd <Plug>(coc-definition)
nmap <silent> <leader>dr <Plug>(coc-references)
nmap <silent> <leader>dj <Plug>(coc-implementation)

" Lightline
set laststatus=2
" For Dev Icons
set encoding=utf8

" vim-plug manager
call plug#begin('~/.vim/plugged')
" Developer Features
Plug 'jiangmiao/auto-pairs'
Plug 'tpope/vim-surround'
Plug 'scrooloose/nerdcommenter'
Plug 'tpope/vim-fugitive'
Plug 'mattn/emmet-vim'
Plug 'neoclide/coc.nvim', {'do': './install.sh nightly'}
Plug 'neoclide/coc-tsserver'
Plug 'neoclide/coc-json'
Plug 'neoclide/coc-css'

" Syntax Highlighting
Plug 'pangloss/vim-javascript'
Plug 'mxw/vim-jsx'
" Linting
Plug 'w0rp/ale'
" UI Enhancements
" Plug 'sjl/badwolf'
Plug 'wmvanvliet/vim-blackboard'
Plug '/usr/local/opt/fzf'
Plug 'junegunn/fzf.vim'
Plug 'terryma/vim-multiple-cursors'
Plug 'airblade/vim-gitgutter'
Plug 'Yggdroot/indentLine'
Plug 'itchyny/lightline.vim'
Plug 'scrooloose/nerdtree'
Plug 'ryanoasis/vim-devicons'
call plug#end()

" Set the theme (must be placed after Plugins)
colorscheme blackboard
