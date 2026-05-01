return {
  {
    "pteroctopus/faster.nvim",
    opts = {
      behaviours = {
        bigfile = {
          on = true,
          filesize = 1.5,
          pattern = "*",
          features_disabled = {
            "matchparen",
            "lsp",
            "treesitter",
            "indent_blankline",
            "vimopts",
            "syntax",
            "filetype",
          },
        },
        -- Keep the replacement scoped to Snacks bigfile behavior.
        fastmacro = {
          on = false,
        },
      },
    },
  },
}
