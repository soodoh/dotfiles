return {
  -- Autocomplete
  {
    "saghen/blink.cmp",
    dependencies = {
      -- common snippets for multiple language
      "rafamadriz/friendly-snippets",
      -- community sources
      "Kaiser-Yang/blink-cmp-avante",
      -- "Kaiser-Yang/blink-cmp-git",
      "MahanRahmati/blink-nerdfont.nvim",
      "moyiz/blink-emoji.nvim",
    },
    version = "1.*",
    opts = {
      keymap = {
        preset = "default",
        ["<Tab>"] = { "select_next", "fallback" },
        ["<S-Tab>"] = { "select_prev", "fallback" },
        ["<C-n>"] = { "snippet_forward", "fallback_to_mappings" },
        ["<C-p>"] = { "snippet_backward", "fallback_to_mappings" },
        ["<CR>"] = { "accept", "fallback" },
      },
      appearance = {
        nerd_font_variant = "mono",
      },
      cmdline = { enabled = true },
      completion = {
        documentation = { auto_show = true },
        trigger = { prefetch_on_insert = true },
        accept = { auto_brackets = { enabled = false } },
        list = { selection = { preselect = false, auto_insert = false } },
      },
      sources = {
        default = {
          -- "git",
          "nerdfont",
          "emoji",
          "lsp",
          "path",
          "snippets",
          "buffer",
        },
        providers = {
          nerdfont = {
            module = "blink-nerdfont",
            name = "Nerd Fonts",
            score_offset = 15,
            opts = { insert = true }, -- Insert nerdfont icon (default) or complete its name
          },
          emoji = {
            module = "blink-emoji",
            name = "Emoji",
            score_offset = 15, -- Tune by preference
            opts = {
              insert = true,
              trigger = function()
                return { ":" }
              end,
            },
          },
        },
      },
      fuzzy = { implementation = "prefer_rust_with_warning" },
    },
    opts_extend = { "sources.default" },
  },
}
