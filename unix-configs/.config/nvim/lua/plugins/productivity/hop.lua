return {
  -- Hotkeys to move in buffer
  {
    "phaazon/hop.nvim",
    branch = "v2", -- optional but strongly recommended
    config = function()
      -- require("hop").setup({ keys = "etovxqpdygfblzhckisuran" })
      require("hop").setup()
      require("which-key").add({
        {
          "s",
          ":HopChar2<CR>",
          desc = "Go to (Hop)",
        },
        {
          "gl",
          ":HopLineStart<CR>",
          desc = "Go to line (Hop)",
        },
      })
    end,
  },
}
