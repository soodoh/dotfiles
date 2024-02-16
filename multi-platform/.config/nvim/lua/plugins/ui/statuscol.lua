return {
  -- Custom number/folds/gitsigns column
  {
    "luukvbaal/statuscol.nvim",
    lazy = false,
    dependencies = { "gitsigns.nvim" },
    config = function()
      local builtin = require("statuscol.builtin")
      require("statuscol").setup({
        relculright = true,
        segments = {
          {
            sign = {
              name = { "Diagnostic" },
              maxwidth = 2,
              auto = true,
            },
            click = "v:lua.ScFa",
          },
          { text = { builtin.lnumfunc }, click = "v:lua.ScLa" },
          {
            sign = {
              namespace = { ".*" },
              maxwidth = 2,
              colwidth = 1,
              auto = true,
              -- wrap = true,
            },
            click = "v:lua.ScSa",
          },
          { text = { builtin.foldfunc }, click = "v:lua.ScFa" },
        },
      })
    end,
  },
}
