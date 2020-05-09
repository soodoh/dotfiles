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

" Custom mappings begin here
"
"
" so that forward delete works in insert mode
" inoremap <C-d> <Esc>lxi
inoremap <C-d> <Del>
let mapleader=","
" other mappings 
noremap <leader>hl :nohlsearch<CR>
noremap <leader>e :NERDTreeToggle<CR>
noremap <leader>ef :NERDTreeFind<CR>

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
" noremap <leader>qf :copen<CR>
noremap [ :cp<CR>
noremap ] :cn<CR>

" Git vim-fugitive hotkeys
noremap <leader>gb :Gblame<CR>
noremap <leader>gd :Gdiff<space>

" NERD commenter settings
let g:NERDSpaceDelims = 1
" Align line-wise comment delimiters flush left instead of following code indentation
let g:NERDDefaultAlign = 'left'

" Lightline
set laststatus=2
" For Dev Icons
set encoding=utf8

" Coc.nvim Intellisense Settings
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-definition)
noremap <leader>ue :CocCommand snippets.editSnippets<CR>
imap <C-l> <Plug>(coc-snippets-expand-jump)
" For coc-highlight
set termguicolors
let g:terminal_color_0  = '#2e3436'
let g:terminal_color_1  = '#cc0000'
let g:terminal_color_2  = '#4e9a06'
let g:terminal_color_3  = '#c4a000'
let g:terminal_color_4  = '#3465a4'
let g:terminal_color_5  = '#75507b'
let g:terminal_color_6  = '#0b939b'
let g:terminal_color_7  = '#d3d7cf'
let g:terminal_color_8  = '#555753'
let g:terminal_color_9  = '#ef2929'
let g:terminal_color_10 = '#8ae234'
let g:terminal_color_11 = '#fce94f'
let g:terminal_color_12 = '#729fcf'
let g:terminal_color_13 = '#ad7fa8'
let g:terminal_color_14 = '#00f5e9'
let g:terminal_color_15 = '#eeeeec'

" air-line
let g:airline#extensions#tabline#enabled = 1
let g:airline_powerline_fonts = 1
let g:airline_theme='jellybeans'

" vim-plug manager
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

" Coc Intellisense
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'neoclide/coc-tsserver', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-tslint-plugin', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-eslint', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-css', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-html', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-json', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-yaml', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-python', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-rls', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-snippets', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-git', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-pairs', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-highlight', {'do': 'yarn install --frozen-lockfile'}

" Syntax Highlighting
Plug 'leafgarland/typescript-vim'
Plug 'pangloss/vim-javascript'
Plug 'HerringtonDarkholme/yats.vim' " Necessary for TSX
Plug 'MaxMEllon/vim-jsx-pretty'
" UI Enhancements
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'ryanoasis/vim-devicons'
" Color schemes
Plug 'nanotech/jellybeans.vim'
call plug#end()

" set the theme (must be placed after plugins)
colorscheme jellybeans
