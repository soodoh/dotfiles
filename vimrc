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
noremap <leader>e :NERDTreeToggle<CR>

" Buffers
nnoremap <C-j> :bp<CR>
nnoremap <C-k> :bn<CR>
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
nnoremap <leader>n :NnnPicker '%:p:h'<CR>
let g:nnn#command = 'nnn -e'
let g:nnn#action = {
      \ '<c-t>': 'tab split',
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
noremap <leader>gd :Gdiff

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
  \ 'typescript': ['eslint', 'tslint'],
  \ 'python': ['yapf', 'isort', 'black', 'autopep8', 'add_blank_lines_for_python_control_statements']
  \ }
let g:ale_linters = {
  \ 'typescript': ['eslint', 'tslint'],
  \ 'javascript': ['eslint'],
  \ 'python': ['pylint', 'pyflake', 'pycodestyle'],
  \ 'rust': ['rustc']
  \ }
let g:ale_sign_error='❌'
let g:ale_sign_warning='⚠️ '
let g:ale_fix_on_save = 1 " Auto-fix on save
highlight ALEErrorSign ctermbg=NONE ctermfg=red
highlight ALEWarningSign ctermbg=NONE ctermfg=yellow

" Lightline
set laststatus=2
" For Dev Icons
set encoding=utf8

" Coc.nvim Intellisense Settings
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-definition)
" nmap <silent> gi <Plug>(coc-implementation)
" nmap <silent> gr <Plug>(coc-references)
noremap <leader>ue :CocCommand snippets.editSnippets<CR>

" air-line
let g:airline#extensions#tabline#enabled = 1
let g:airline_powerline_fonts = 1
let g:airline_theme='deus'

" vim-plug manager
call plug#begin('~/.config/nvim/plugged')
" Developer Features
" Plug 'jiangmiao/auto-pairs'
Plug 'tpope/vim-surround'
Plug 'scrooloose/nerdcommenter'
Plug 'tpope/vim-fugitive'
Plug 'mcchrish/nnn.vim'
Plug 'preservim/nerdtree'
Plug 'jremmen/vim-ripgrep'
Plug 'junegunn/fzf', { 'dir': '~/.fzf', 'do': './install --all' }
Plug 'junegunn/fzf.vim'
Plug 'moll/vim-bbye'

" Coc Intellisense
Plug 'neoclide/coc.nvim', {'do': './install.sh nightly'}

" Syntax Highlighting
Plug 'leafgarland/typescript-vim'
Plug 'pangloss/vim-javascript'
Plug 'MaxMEllon/vim-jsx-pretty'
" Linting
Plug 'w0rp/ale'
" UI Enhancements
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'ryanoasis/vim-devicons'
Plug 'ap/vim-css-color'
" Color schemes
Plug 'rakr/vim-one'
call plug#end()

" set the theme (must be placed after plugins)
colorscheme one
set background=dark
