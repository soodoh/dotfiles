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
" set lazyredraw
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
" so that forward delete works in insert mode
" inoremap <C-d> <Esc>lxi
inoremap <C-d> <Del>

" Custom mappings begin here
let mapleader=","
" Searching hotkeys
noremap <leader>hl :nohlsearch<CR>
noremap <leader><space> :Files<CR>
noremap <leader>e :Explore<CR>
noremap <leader>f :grep
noremap [ :cp<CR>
noremap ] :cn<CR>
noremap <leader>qf :copen<CR>
" Git hotkeys
noremap <leader>gb :Gblame<CR>
noremap <leader>gd :Gdiff<CR>
" Linting hotkeys
noremap <leader>af :ALEFix<CR>
noremap <leader>an :ALENext<CR>
noremap <leader>!s :!sort<CR>
noremap <leader>s :sort<CR>
noremap <leader>ue :UltiSnipsEdit<CR>

" UltiSnips Settings
let g:UltiSnipsSnippetsDir = $HOME.'/.vim/UltiSnips'
let g:UltiSnipsSnippetDirectories = ['UltiSnips', $HOME.'/.vim/UltiSnips']
let g:UltiSnipsEditSplit="vertical"

" So FZF will ignore files from .gitignore
" let $FZF_DEFAULT_COMMAND = 'ag --hidden --ignore .git -g ""'
"
" FZF window layout
let g:fzf_layout = { 'window': '20split enew' }
" So FZF will have Preview
command! -bang -nargs=? -complete=dir Files
  \ call fzf#vim#files(<q-args>, fzf#vim#with_preview('right:50%', 'ctrl-p'), <bang>0)

" NERD commenter settings
let g:NERDSpaceDelims = 1
" Align line-wise comment delimiters flush left instead of following code indentation
let g:NERDDefaultAlign = 'left'

" Linting settings
let g:ale_linter_aliases = {
  \ 'jsx': ['javascript']
  \ }
let g:ale_fixers = {
  \ '*': ['trim_whitespace'],
  \ 'javascript': ['eslint'],
  \ 'python': ['yapf', 'isort', 'black', 'autopep8', 'add_blank_lines_for_python_control_statements']
  \ }
let g:ale_linters = {
  \ 'javascript': ['eslint'],
  \ 'python': ['pylint', 'pyflake', 'pycodestyle'],
  \ 'rust': ['rustc']
  \ }
" let g:ale_sign_error='❌'
" let g:ale_sign_warning='⚠️ '
let g:ale_fix_on_save = 1 " Auto-fix on save
highlight ALEErrorSign ctermbg=NONE ctermfg=red
highlight ALEWarningSign ctermbg=NONE ctermfg=yellow

" Coc.nvim Intellisense Settings
" nmap <silent> <leader>dd <Plug>(coc-definition)
" nmap <silent> <leader>dr <Plug>(coc-references)
" nmap <silent> <leader>dj <Plug>(coc-implementation)

" Lightline
set laststatus=2
" For Dev Icons
set encoding=utf8

" Install vim-plug if it is missing
if empty(glob('~/.vim/autoload/plug.vim'))
  silent !curl -fLo ~/.vim/autoload/plug.vim --create-dirs
    \ https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
  autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
endif
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
Plug 'plasticboy/vim-markdown'
Plug 'SirVer/ultisnips'
" Plug 'ycm-core/YouCompleteMe'

" Syntax Highlighting
Plug 'pangloss/vim-javascript'
Plug 'mxw/vim-jsx'
" Linting
Plug 'w0rp/ale'
" UI Enhancements
" Plug 'sjl/badwolf'
" Plug 'airblade/vim-gitgutter'
Plug 'wmvanvliet/vim-blackboard'
Plug '/usr/bin/fzf'
Plug 'junegunn/fzf.vim'
Plug 'terryma/vim-multiple-cursors'
Plug 'ap/vim-css-color'
Plug 'Yggdroot/indentLine'
Plug 'itchyny/lightline.vim'
Plug 'ryanoasis/vim-devicons'
call plug#end()

" set the theme (must be placed after plugins)
colorscheme blackboard
