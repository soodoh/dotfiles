return {
  -- Switch windows or to tmux from nvim
  {
    "alexghergh/nvim-tmux-navigation",
    config = function()
      require("nvim-tmux-navigation").setup({})
      vim.keymap.set(
        "n",
        "<C-h>",
        ":NvimTmuxNavigateLeft<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<C-Left>",
        ":NvimTmuxNavigateLeft<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<C-j>",
        ":NvimTmuxNavigateDown<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<C-Down>",
        ":NvimTmuxNavigateDown<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<C-k>",
        ":NvimTmuxNavigateUp<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<C-Up>",
        ":NvimTmuxNavigateUp<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<C-l>",
        ":NvimTmuxNavigateRight<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<C-Right>",
        ":NvimTmuxNavigateRight<CR>",
        { silent = true }
      )
    end,
  },
}
