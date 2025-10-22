return {
  -- Hotkeys to move in buffer
  {
    "smoka7/hop.nvim",
    version = "*",
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
