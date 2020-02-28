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

" Custom mappings begin here
"
"
" so that forward delete works in insert mode
" inoremap <C-d> <Esc>lxi
inoremap <C-d> <Del>
let mapleader=","
noremap <leader>hl :nohlsearch<CR>

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
nnoremap <leader>n :NnnPicker '%:p:h'<CR>
let g:nnn#action = {
      \ '<c-t>': 'tab split',
      \ '<c-x>': 'split',
      \ '<c-v>': 'vsplit'
      \ }

" RipGrep
noremap <leader>f :Rg<space>
let g:rg_command = 'rg --vimgrep -S'

" Quick fix bindings
noremap <leader>qf :copen<CR>
noremap [ :cp<CR>
noremap ] :cn<CR>

" Git vim-fugitive hotkeys
noremap <leader>gb :Gblame<CR>
noremap <leader>gd :Gdiff<CR>

" NERD commenter settings
let g:NERDSpaceDelims = 1
" Align line-wise comment delimiters flush left instead of following code indentation
let g:NERDDefaultAlign = 'left'

" Linting hotkeys
noremap <leader>af :ALEFix<CR>
noremap <leader>an :ALENext<CR>
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

" Lightline
set laststatus=2
" For Dev Icons
set encoding=utf8

" Coc.nvim Intellisense Settings
" nmap <silent> <leader>dd <Plug>(coc-definition)
" nmap <silent> <leader>dr <Plug>(coc-references)
" nmap <silent> <leader>dj <Plug>(coc-implementation)
noremap <leader>ue :CocCommand snippets.editSnippets<CR>

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
Plug 'mcchrish/nnn.vim'
Plug 'jremmen/vim-ripgrep'
Plug 'junegunn/fzf', { 'dir': '~/.fzf', 'do': './install --all' }
Plug 'junegunn/fzf.vim'
Plug 'ap/vim-css-color'
"
" Coc Intellisense
Plug 'neoclide/coc.nvim', {'do': './install.sh nightly'}
Plug 'neoclide/coc-tsserver'
Plug 'neoclide/coc-json'
Plug 'neoclide/coc-html'
Plug 'neoclide/coc-css'
Plug 'neoclide/coc-eslint'
Plug 'neoclide/coc-python'
Plug 'neoclide/coc-rls'
Plug 'neoclide/coc-yaml'

" Syntax Highlighting
Plug 'pangloss/vim-javascript'
Plug 'mxw/vim-jsx'
" Linting
Plug 'w0rp/ale'
" UI Enhancements
Plug 'wmvanvliet/vim-blackboard'
Plug 'Yggdroot/indentLine'
Plug 'itchyny/lightline.vim'
Plug 'ryanoasis/vim-devicons'
call plug#end()

" set the theme (must be placed after plugins)
colorscheme blackboard
