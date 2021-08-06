""""" vim-plug manager
call plug#begin('~/.config/nvim/plugged')
" Developer Features
Plug 'tpope/vim-surround'
Plug 'scrooloose/nerdcommenter'
Plug 'tpope/vim-fugitive'
Plug 'mcchrish/nnn.vim'
Plug 'preservim/nerdtree'
Plug 'jremmen/vim-ripgrep'
Plug 'junegunn/fzf', { 'dir': '~/.fzf', 'do': './install --all' }
Plug 'junegunn/fzf.vim'
Plug 'moll/vim-bbye'
Plug 'christoomey/vim-tmux-navigator'
Plug 'norcalli/nvim-colorizer.lua'

" Coc Intellisense
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'neoclide/coc-snippets', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-git', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-tsserver', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-eslint', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-css', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-html', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-json', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/jsonc.vim'
Plug 'neoclide/coc-yaml', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-rls', {'do': 'yarn install --frozen-lockfile'}

" Syntax Highlighting
Plug 'sheerun/vim-polyglot'

" UI Enhancements
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'ryanoasis/vim-devicons'
" Color schemes
Plug 'arcticicestudio/nord-vim'
call plug#end()

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
" inoremap jj <ESC>
" so that Ctrl+C triggers InsertLeave autocmd
inoremap <C-c> <ESC>
" so that forward delete works in insert mode
inoremap <C-d> <Del>
let mapleader=","
" other mappings 
noremap <leader>hl :nohlsearch<CR>
noremap <leader>e :NERDTreeToggle<CR>
noremap <leader>ef :NERDTreeFind<CR>

" Quick fix bindings
noremap [q :cp<CR>
noremap ]q :cn<CR>
" Buffers
noremap [b :bp<CR>
noremap ]b :bn<CR>
nnoremap <leader>b :ls<CR>:b<space>
nnoremap <leader>bd :Bdelete<CR>

" Easier sorting
noremap <leader>!s :!sort<CR>
noremap <leader>s :sort<CR>

" FZF window binding
noremap <expr> <leader><space> (len(system('git rev-parse')) ? ':Files' : ':GFiles --exclude-standard --others --cached')."\<cr>"
" FZF window layout
let g:fzf_layout = { 'window': '20split enew' }
" So FZF will have Preview
command! -bang -nargs=? -complete=dir Files
  \ call fzf#vim#files(<q-args>, fzf#vim#with_preview('right:50%', 'ctrl-p'), <bang>0)

" nnn
" Disable default mappings
let g:nnn#set_default_mappings = 0
" Start nnn in the current file's directory
nnoremap <leader>n :NnnPicker %:p:h<CR>
let g:nnn#command = 'nnn -e'
let g:nnn#action = {
      \ '<c-t>': 'tab split',
      \ '<c-v>': 'vsplit'
      \ }

" RipGrep
noremap <leader>f :Rg<space>
let g:rg_command = 'rg --vimgrep -S'

" Git vim-fugitive hotkeys
noremap <leader>gb :Git blame<CR>
noremap <leader>gd :Gdiff<space>

" NERD commenter settings
let g:NERDSpaceDelims = 1
" Align line-wise comment delimiters flush left instead of following code indentation
let g:NERDDefaultAlign = 'left'

" Coc.nvim Intellisense Settings
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-definition)
noremap <leader>ue :CocCommand snippets.editSnippets<CR>
imap <C-l> <Plug>(coc-snippets-expand-jump)

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
